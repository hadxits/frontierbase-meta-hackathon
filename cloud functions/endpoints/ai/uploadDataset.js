/**
 * ============================================================================
 * uploadDataset.js - Dataset 업로드 및 인덱싱 엔드포인트
 * ============================================================================
 *
 * 새 파일(new_file_path)은 항상 JSONL 형식입니다. Firestore에는 source_type을
 * 그대로 저장(ex: excel, csv)하고, worker.js를 트리거하여 Qdrant 벡터 DB에
 * 임베딩을 저장하는 엔드포인트입니다.
 *
 * 주요 특징:
 * 1. 파일 파싱: new_file_path(GCS)의 JSONL만 파싱 (row_id, text, version)
 * 2. 검증 및 체크:
 *    - 토큰 한도 체크 (워커 실행 전)
 *    - dataset_limit 체크 (신규 dataset 생성 시, tenant quota 기반)
 *    - MAX_ROWS 체크 (tenant quota 기반)
 *    - CANONICAL_MAX_TEXT_CHARS 체크 (소스/언어와 무관한 canonical 제한)
 * 3. Incremental 업데이트: 기존 row_id와 비교하여 추가/업데이트 분류
 * 4. worker.js 트리거: Cloud Tasks → workerTask.js → Cloud Run Job 실행
 *
 * 처리 흐름:
 * 1. 파라미터 검증
 * 2. Tenant 검증 및 데이터 로드
 * 3. Dataset 결정
 * 4. 이전 JSONL 파일 로드 (dataset의 마지막 jsonl_paths에서 가져오기)
 * 5. 새 파일 다운로드 (JSONL)
 * 6. JSONL 파싱 (newRows)
 * 7. 행 수 및 텍스트 길이 체크 (MAX_ROWS, CANONICAL_MAX_TEXT_CHARS)
 * 8. Diff 수행 (oldRows와 newRows 비교하여 toAdd/toArchive 분류)
 * 8b. 이전 JSONL이 있고 toAdd/toArchive가 모두 0이면 변경 없음 → GCS/worker 생략 (sync와 동일 메시지)
 * 9. JSONL 변환 및 GCS 저장 (2개: 전체용 + 작업용)
 *    - fullJsonlPath: 전체 newRows (삭제 파악용, 다음번 비교용)
 *    - workerJsonlPath: toAdd만 (실제 작업용)
 * 10. 토큰 한도 체크 (한도 초과 시 dataset 문서 생성/업데이트 없이 즉시 실패)
 * 11. Dataset 문서 기본 정보 업데이트 (name, source_type, source_ref, rows, cols 등; jsonl_paths는 worker.js 완료 후 저장)
 * 12. Cloud Tasks에 작업 enqueue (workerTask.js가 Cloud Run Job 실행)
 *
 * 참고:
 * - source_type은 클라이언트에서 전달한 값(excel, csv, google_sheets 등)을 Firestore에 그대로 저장합니다.
 * - source_type이 google_sheets일 때 refresh_token을 넘기면 AES 암호화 후 tenant 문서에 저장합니다 (수동/자동 동기화용).
 * - source_type이 google_sheets일 때 source_ref는 항상 new_file_path(gs:// JSONL)로 저장합니다. 파일 다운로드(getSourceDownloadUrl dataset_id)는 jsonl_paths 마지막 스냅샷 우선. 스프레드시트는 spreadsheet_id/sheet_id로 식별합니다.
 * - worker.js는 canonical JSONL 검증과 delete-only/no-op 가드를 포함해 후단 안전성을 한 번 더 확인합니다.
 * ============================================================================
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const {
  logInfo,
  logOperationalWarn,
  logAndCaptureError,
  logWarn,
  shouldCaptureError
} = require("@/utils/logger");
const { store, storage } = require("@/firebase");
const { FieldValue } = require("firebase-admin/firestore");
const Collection = require("@/const/firestore/Collection");
// Cloud Tasks 관련 함수
const {
  enqueueWorkerTask,
  getWorkerPipelineCount
} = require("@/utils/cloudTasks");

// 다국어 지원 함수
const {
  getLocalizedErrorMessage,
} = require("@/utils/localization");

// Tenant 관련 공통 함수
const { loadAndValidateTenant } = require("@/utils/tenant");

// 메시지 관련 공통 함수
const { getDatasetSuccessMessage } = require("@/utils/messages");
const {
  estimateIngestCompletionSeconds
} = require("@/utils/estimateIngestEta");

// Dataset 상태 상수
const DatasetStatus = require("@/const/DatasetStatus");

// 데이터 소스 타입 상수
const SourceType = require("@/const/SourceType");

// 토큰·데이터셋 한도 체크 유틸리티
const checkTokenLimit = require("@/utils/checkTokenLimit");
const checkDatasetLimit = require("@/utils/checkDatasetLimit");

// Qdrant 컬렉션 이름 (실제 벡터 처리는 인덱싱 워커에서 수행)
const { getQdrantCollectionName } = require("@/utils/qdrant");

// 공통 설정 상수
const { AppConfig } = require("@/const/AppConfig");

// refresh_token 암호화 (google_sheets용, tenant 문서 저장)
const { encrypt } = require("@/utils/crypt");

const { parseJsonlToRows, hasJsonlParseIssues } = require("@/utils/jsonl");
const { buildDatasetProfile } = require("@/utils/datasetProfile");

const crypto = require("crypto");

const CANONICAL_MAX_TEXT_CHARS = 2048;

// embed_value는 worker.js에서 dataset별 평균 임베딩으로 계산·저장 (uploadDataset에서는 미사용)

// ============================================================================
// 유틸리티 함수
// ============================================================================

function normalizeJsonlRowForCompare(row) {
  const rowMeta =
    row?.rowMeta && typeof row.rowMeta === "object" ? row.rowMeta : null;
  return {
    text: String(row?.text || ""),
    meta: rowMeta
      ? {
        row_kind_guess:
          typeof rowMeta.row_kind_guess === "string"
            ? rowMeta.row_kind_guess
            : "unknown",
        is_long_text: rowMeta.is_long_text === true,
        has_section_marker: rowMeta.has_section_marker === true,
        policy_like: rowMeta.policy_like === true,
        faq_like: rowMeta.faq_like === true,
        list_like: rowMeta.list_like === true,
        record_like: rowMeta.record_like === true
      }
      : null
  };
}

function getJsonlRowContentSignature(row) {
  return JSON.stringify(normalizeJsonlRowForCompare(row));
}

function serializeJsonlRow(row) {
  const payload = {
    row_id: row.rowId,
    text: row.text,
    version: row.version || 1
  };
  if (row?.rowMeta && typeof row.rowMeta === "object") {
    payload.meta = row.rowMeta;
  }
  return JSON.stringify(payload);
}

function createIngestJobId({ tenant, datasetId, fullGcsPath, workerGcsPath }) {
  const digest = crypto
    .createHash("sha256")
    .update(`${tenant}\0${datasetId}\0${fullGcsPath}\0${workerGcsPath}`)
    .digest("hex")
    .slice(0, 40);
  return `ingest-${digest}`;
}

/**
 * 중복 row_id 처리
 * @param {Array} rows - 행 배열
 * @returns {Object} - { rows, duplicates }
 */
function handleDuplicateRowIds(rows) {
  const rowIdMap = new Map(); // rowId -> [rows]
  const duplicates = [];

  // row_id별로 그룹화
  for (const row of rows) {
    if (!rowIdMap.has(row.rowId)) {
      rowIdMap.set(row.rowId, []);
    }
    rowIdMap.get(row.rowId).push(row);
  }

  // 중복 처리
  for (const [rowId, duplicateRows] of rowIdMap) {
    if (duplicateRows.length > 1) {
      // 중복 발견: 두 번째부터 고유 번호 추가
      // 중복 처리 시에도 32자리 해시 사용 (32바이트, Firestore 제한 내)
      duplicateRows.forEach((row, index) => {
        if (index > 0) {
          row.rowId = crypto
            .createHash("sha256")
            .update(`${rowId}|dup${index}`)
            .digest("hex")
            .slice(0, 32);
        }
        duplicates.push(row);
      });
    }
  }

  return { rows, duplicates };
}

// ============================================================================
// Dataset 상태 업데이트 헬퍼 함수
// ============================================================================

/**
 * Dataset 문서에 실패 상태를 기록하는 헬퍼 함수
 * 버전 관리는 row별로만 수행 (dataset별 versions 컬렉션 제거)
 * @param {string} tenant - 테넌트 ID
 * @param {string} datasetId - dataset ID
 * @param {string} source_type - 파일 타입
 * @param {string} storage_path - GCS 경로
 * @param {string} embed_model - 임베딩 모델
 * @param {string} description - 설명
 * @param {string} qdrant_url - Qdrant URL
 * @param {string} errorMessage - 오류 메시지
 * @param {string} [name] - 데이터셋 이름
 * @param {string} [source_ref] - 소스 참조 (예: 파일 경로)
 * @param {string|null} [expectedProcessingJobId] - 실패 처리할 작업 소유권 ID
 */
async function setDatasetToFailed(
  tenant,
  datasetId,
  source_type,
  storage_path,
  embed_model,
  description,
  qdrant_url,
  errorMessage,
  name = "",
  source_ref = "",
  expectedProcessingJobId = null
) {
  const now = Date.now();
  // tenants/{tenantId}/datasets/{datasetId}
  const datasetRef = store
    .collection(Collection.TENANTS)
    .doc(tenant)
    .collection(Collection.DATASETS)
    .doc(datasetId);

  const qdrant_collection = getQdrantCollectionName(tenant);
  const failurePayload = {
    dataset_id: datasetId,
    tenant_id: tenant,
    name: name || "",
    source_type,
    source_ref: source_ref || "",
    status: DatasetStatus.FAILED,
    error: errorMessage, // 오류 메시지 저장
    embed_model: embed_model,
    description: description || "",
    qdrant_url: qdrant_url,
    qdrant_collection, // tenant 기준 Qdrant 컬렉션 이름 (검색/디버깅용)
    created_at: now,
    updated_at: now
  };

  await store.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(datasetRef);
    const currentData = snapshot.exists ? snapshot.data() : {};
    const currentStatus = currentData?.status;
    const currentJobId = currentData?.processing_job_id;
    const hasActiveOwner =
      (currentStatus === DatasetStatus.PROCESSING ||
        currentStatus === DatasetStatus.INDEXING);

    if (
      (expectedProcessingJobId &&
        snapshot.exists &&
        (currentJobId !== expectedProcessingJobId ||
          currentStatus !== DatasetStatus.PROCESSING)) ||
      (!expectedProcessingJobId && hasActiveOwner)
    ) {
      return;
    }

    transaction.set(
      datasetRef,
      {
        ...failurePayload,
        ...(expectedProcessingJobId
          ? { processing_job_id: FieldValue.delete() }
          : {})
      },
      { merge: true }
    );
  });
}

const uploadDataset = _onRequest({
  opts: {
    memory: "2GiB", // 메모리 할당량 (2GiB)
    cpu: 2, // vCPU 개수 (2세대: 1 또는 2, 기본값은 memory에 따라 1 또는 2)
    maxInstances: 10,
    concurrency: 2,
    timeoutSeconds: 180 // 1분 (오래 걸려도 task에서 부하이지 여기서는 오래 걸리면 안됨)
  },
  requireCredential: true,
  stream: false,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      dataset_id: { type: PropertyType.STRING }, // dataset ID (직접 지정)
      name: { type: PropertyType.STRING }, // dataset name
      source_type: {
        type: PropertyType.STRING,
        enum: [
          SourceType.EXCEL,
          SourceType.CSV,
          SourceType.GOOGLE_SHEETS,
          SourceType.MANUAL
        ]
      },
      new_file_path: { type: PropertyType.STRING }, // 새 파일 경로 (JSONL) (예: gs://bucket/path/file.jsonl)
      description: { type: PropertyType.STRING },
      source_ref: { type: PropertyType.STRING }, // excel/csv 등: 경로·URL. google_sheets: 무시되고 new_file_path(gs://)가 저장됨
      refresh_token: { type: PropertyType.STRING }, // google_sheets 시 Google OAuth refresh_token (암호화하여 tenant에 저장, 수동/자동 동기화용)
      spreadsheetId: { type: PropertyType.STRING }, // google_sheets 시 스프레드시트 ID (dataset에 저장)
      sheetId: { type: PropertyType.STRING }, // google_sheets 시 시트 ID (dataset에 저장)
      spreadsheetName: { type: PropertyType.STRING }, // google_sheets 시 스프레드시트 이름 (dataset에 저장)
      rows: { type: PropertyType.NUMBER }, // 행 수 (클라이언트 필수 전달, 실제 데이터 기준)
      cols: { type: PropertyType.NUMBER } // 컬럼 수 (클라이언트 필수 전달, 원본 소스 기준)
    },
    required: ["tenant", "dataset_id", "source_type", "new_file_path", "rows", "cols"]
  },
  handler: async (req, res) => {
    try {
      return await runUploadDataset(req.body);
    } catch (e) {
      if (shouldCaptureError(e)) {
        logAndCaptureError(
          e instanceof Error ? e : new Error(String(e)),
          "[uploadDataset] Error",
          {
            tenant_id: req.body?.tenant || "unknown",
            function_name: "uploadDataset",
            extra: {
              errorCode: e instanceof ApiError ? e.errorCode : undefined
            }
          }
        );
      }
      throw e;
    }
  }
});

/**
 * 업로드 핵심 로직 (HTTP 핸들러와 syncGoogleSheetsDataset 등에서 공통 사용)
 * @param {Object} params - uploadDataset 요청과 동일 (tenant, dataset_id, new_file_path, source_type, name, source_ref, refresh_token, spreadsheetId, sheetId, spreadsheetName 등). google_sheets일 때 source_ref는 무시되고 new_file_path가 저장됨.
 * @returns {Promise<{ success: boolean, dataset_id: string, record_count: number, message: string, pending_tasks_count: number, full_jsonl_path?: string, worker_jsonl_path?: string, synced?: boolean, noChange?: boolean }>}
 */
async function runUploadDataset(params) {
  const {
    tenant,
    dataset_id, // dataset ID (직접 지정)
    name,
    source_type,
    new_file_path, // 새 파일 경로 (JSONL)
    description,
    source_ref: sourceRefBody,
    refresh_token: refreshTokenBody,
    spreadsheetId: spreadsheetIdBody,
    sheetId: sheetIdBody,
    spreadsheetName: spreadsheetNameBody,
    rows: rowsBody,
    cols: colsBody
  } = params ?? {};
  const source_ref =
    sourceRefBody != null && sourceRefBody !== ""
      ? sourceRefBody
      : new_file_path;

  // 공통 상수 사용
  const embed_model = AppConfig.DEFAULT_EMBED_MODEL; // "text-embedding-3-small"
  const project_id = AppConfig.GCP_PROJECT_ID; // "frontierbase-console"

  // 벡터 차원 결정 (critical 값, embed_model에 따라 결정)
  // 기본값: text-embedding-3-small (1536차원)
  const getVectorSizeFromModel = (model) => {
    if (model.includes("text-embedding-3-small")) return 1536;
    if (model.includes("text-embedding-3-large")) return 3072;
    // 기본값: small (1536차원)
    return 1536;
  };
  const vector_size = getVectorSizeFromModel(embed_model);

  // ========================================================================
  // 0. 파라미터 검증
  // ========================================================================
  if (
    tenant == null ||
    typeof tenant !== "string" ||
    tenant.trim().length === 0
  ) {
    logOperationalWarn("[uploadDataset] INVALID_TENANT_ID", {
      tenant_id: "unknown",
      function_name: "uploadDataset",
      extra: { errorCode: "INVALID_TENANT_ID" }
    });
    throw new ApiError({
      errorCode: "INVALID_TENANT_ID",
      message: getLocalizedErrorMessage("en", "INVALID_TENANT_ID"),
      httpStatusCode: 400,
      returnToUser: true
    });
  }

  if (
    !dataset_id ||
    typeof dataset_id !== "string" ||
    dataset_id.trim().length === 0
  ) {
    logOperationalWarn("[uploadDataset] INVALID_DATASET_ID", {
      tenant_id: tenant,
      function_name: "uploadDataset",
      extra: { errorCode: "INVALID_DATASET_ID" }
    });
    throw new ApiError({
      errorCode: "INVALID_DATASET_ID",
      message: getLocalizedErrorMessage("en", "INVALID_DATASET_ID"),
      httpStatusCode: 400,
      returnToUser: true
    });
  }

  const rowsParam = Number(rowsBody);
  const colsParam = Number(colsBody);
  if (
    !Number.isInteger(rowsParam) ||
    rowsParam < 0 ||
    !Number.isInteger(colsParam) ||
    colsParam < 1
  ) {
    logOperationalWarn("[uploadDataset] INVALID_ROWS_OR_COLS", {
      tenant_id: tenant,
      function_name: "uploadDataset",
      extra: {
        errorCode: "INVALID_ROWS_OR_COLS",
        rows: rowsBody,
        cols: colsBody
      }
    });
    throw new ApiError({
      errorCode: "INVALID_ROWS_OR_COLS",
      message: getLocalizedErrorMessage("en", "INVALID_ROWS_OR_COLS"),
      httpStatusCode: 400,
      returnToUser: true
    });
  }

  // ========================================================================
  // 1. Tenant 검증 및 데이터 로드
  // ========================================================================
  const { tenantData, locale, qdrant_url } = await loadAndValidateTenant(
    tenant,
    {
      locale: "en", // tenant 조회 전 임시 locale
      functionName: "uploadDataset"
    }
  );

  // tenant의 quota에서 row_limit_per_dataset 가져오기 (기본값: 100)
  let MAX_ROWS = tenantData?.quota?.row_limit_per_dataset ?? 100;
  MAX_ROWS += 2;

  logInfo("[uploadDataset] Request received", {
    tenant_id: tenant,
    function_name: "uploadDataset",
    extra: {
      dataset_id,
      source_type,
      new_file_path,
      qdrant_url,
      embed_model,
      project_id,
      locale
    }
  });

  // 텍스트 길이 제한은 source/tenant language와 무관한 canonical 계약으로 고정한다.
  const MAX_TEXT_CHARS = CANONICAL_MAX_TEXT_CHARS;

  // ========================================================================
  // 2. Dataset 결정
  // ========================================================================
  // dataset_id는 그대로 사용
  // 버전 관리는 row별로만 수행 (dataset별 versions 컬렉션 제거)
  const finalDatasetId = dataset_id;
  let activeProcessingJobId = null;

  // ========================================================================
  // 헬퍼: 에러 발생 시 Dataset 상태를 failed로 설정하고 에러 throw
  // ========================================================================
  /**
   * Dataset 상태를 failed로 설정하고 ApiError를 throw하는 헬퍼 함수
   * @param {string} errorCode - 에러 코드 (예: "NO_DATA_FOUND")
   * @param {Object} [options] - 옵션
   * @param {number} [options.httpStatusCode=400] - HTTP 상태 코드
   * @param {Error} [options.originalError] - 원본 에러 (있으면 이 에러를 throw)
   * @param {Object} [options.logDetails] - 추가 로깅 정보 (logOperationalWarn에 포함)
   * @param {boolean} [options.returnToUser=true] - true면 클라이언트에 에러 코드/메시지 전달
   * @param {Object} [options.details] - 클라이언트에 전달할 상세 정보 (returnToUser 시 응답 body에 포함)
   * @param {string} [options.localizedErrorKey] - 다국어 메시지 키 (지정 시 errorCode 대신 사용, streamChatRag와 동일 메시지용)
   */
  const failDatasetAndThrow = async (errorCode, options = {}) => {
    const {
      httpStatusCode = 400,
      originalError = null,
      logDetails = null,
      returnToUser = true,
      details = null,
      localizedErrorKey = null
    } = options;

    const messageKey = localizedErrorKey || errorCode;
    const errorMsg =
      originalError instanceof ApiError
        ? originalError.message
        : getLocalizedErrorMessage(locale, messageKey);

    logOperationalWarn(`[uploadDataset] ${errorCode}`, {
      tenant_id: tenant,
      function_name: "uploadDataset",
      extra: {
        dataset_id: finalDatasetId,
        ...(logDetails || {})
      }
    });

    await setDatasetToFailed(
      tenant,
      finalDatasetId,
      source_type,
      new_file_path,
      embed_model,
      description,
      qdrant_url,
      errorMsg,
      name,
      source_ref,
      activeProcessingJobId
    );

    if (originalError) {
      throw originalError;
    }

    throw new ApiError({
      errorCode,
      message: errorMsg,
      httpStatusCode,
      returnToUser,
      data: details
    });
  };

  logInfo("[uploadDataset] Dataset ID determined", {
    tenant_id: tenant,
    function_name: "uploadDataset",
    extra: { dataset_id: finalDatasetId }
  });

  const datasetRef = store
    .collection(Collection.TENANTS)
    .doc(tenant)
    .collection(Collection.DATASETS)
    .doc(finalDatasetId);

  let datasetDoc;
  let isExistingDataset = false;
  let skipDatasetLimitCheck = false;
  try {
    datasetDoc = await datasetRef.get();
    isExistingDataset = datasetDoc.exists === true;
  } catch (datasetErr) {
    // 문서 존재 여부를 모를 때 한도 체크를 강행하면 기존 dataset 재업로드가 오탐될 수 있음
    skipDatasetLimitCheck = true;
    logWarn("[uploadDataset] Failed to load dataset document", {
      tenant_id: tenant,
      function_name: "uploadDataset",
      extra: { dataset_id: finalDatasetId, error: datasetErr?.message }
    });
  }

  // ========================================================================
  // 2b. 데이터셋 개수 한도 체크 (신규 dataset만)
  // ========================================================================
  if (!skipDatasetLimitCheck) {
    const datasetLimitResult = await checkDatasetLimit(tenant, {
      locale,
      tenantData,
      isExistingDataset
    });

    logInfo("[uploadDataset] Dataset limit check", {
      tenant_id: tenant,
      function_name: "uploadDataset",
      extra: {
        dataset_id: finalDatasetId,
        is_existing_dataset: isExistingDataset,
        details: datasetLimitResult.details
      }
    });

    if (datasetLimitResult.exceeded) {
      logOperationalWarn("[uploadDataset] QUOTA_EXCEEDED", {
        tenant_id: tenant,
        function_name: "uploadDataset",
        extra: {
          dataset_id: finalDatasetId,
          ...(datasetLimitResult.details || {})
        }
      });
      throw new ApiError({
        errorCode: "QUOTA_EXCEEDED",
        message: datasetLimitResult.message,
        httpStatusCode: 429,
        returnToUser: true,
        data: datasetLimitResult.details
      });
    }
  }

  // ========================================================================
  // 3. 이전 JSONL 파일 로드 (dataset에서 마지막 jsonl_paths 가져오기)
  // ========================================================================
  let oldRows = [];
  let actualOldJsonlPath = null;

  if (isExistingDataset && datasetDoc) {
    const datasetData = datasetDoc.data();
    const jsonlPaths = datasetData?.jsonl_paths || [];

    if (Array.isArray(jsonlPaths) && jsonlPaths.length > 0) {
      const lastPath = jsonlPaths[jsonlPaths.length - 1];
      actualOldJsonlPath = lastPath?.gcs_path || null;

      if (actualOldJsonlPath) {
        logInfo("[uploadDataset] Using last JSONL path from dataset", {
          tenant_id: tenant,
          function_name: "uploadDataset",
          extra: {
            dataset_id: finalDatasetId,
            old_jsonl_path: actualOldJsonlPath
          }
        });
      }
    }
  }

  // old_jsonl_path 로드 (dataset에서 가져온 경우)
  if (actualOldJsonlPath) {
    try {
      const oldGsPathMatch = actualOldJsonlPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
      if (oldGsPathMatch) {
        const [oldBucket, oldFilePath] = [oldGsPathMatch[1], oldGsPathMatch[2]];
        const oldFile = storage.bucket(oldBucket).file(oldFilePath);

        // 이전 JSONL 파일 존재 확인
        const [oldExists] = await oldFile.exists();
        if (oldExists) {
          // 이전 JSONL 파일 다운로드 및 파싱
          const [oldJsonlBuffer] = await oldFile.download();
          const oldJsonlText = oldJsonlBuffer.toString("utf-8");
          const parsedOldRows = parseJsonlToRows(oldJsonlText);
          oldRows = parsedOldRows.rows;
          if (hasJsonlParseIssues(parsedOldRows.issues)) {
            logWarn("[uploadDataset] Old JSONL contains invalid canonical rows", {
              tenant_id: tenant,
              function_name: "uploadDataset",
              extra: {
                dataset_id: finalDatasetId,
                old_jsonl_path: actualOldJsonlPath,
                issues: parsedOldRows.issues
              }
            });
          }

          logInfo("[uploadDataset] Old JSONL loaded", {
            tenant_id: tenant,
            function_name: "uploadDataset",
            extra: {
              old_jsonl_path: actualOldJsonlPath,
              old_rows_count: oldRows.length
            }
          });
        } else {
          logWarn("[uploadDataset] Old JSONL file not found", {
            tenant_id: tenant,
            function_name: "uploadDataset",
            extra: { old_jsonl_path: actualOldJsonlPath }
          });
        }
      }
    } catch (oldErr) {
      logWarn("[uploadDataset] Failed to load old JSONL", {
        tenant_id: tenant,
        function_name: "uploadDataset",
        extra: {
          old_jsonl_path: actualOldJsonlPath,
          error: oldErr?.message
        }
      });
      // old 파일 로드 실패해도 계속 진행 (전체 처리)
    }
  }

  // ========================================================================
  // 4. 새 파일 다운로드 (JSONL)
  // ========================================================================
  const newGsPathMatch = new_file_path.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!newGsPathMatch) {
    await failDatasetAndThrow("INVALID_STORAGE_PATH");
  }

  const [bucket, filePath] = [newGsPathMatch[1], newGsPathMatch[2]];
  const file = storage.bucket(bucket).file(filePath);

  // 파일 존재 확인
  const [exists] = await file.exists();
  if (!exists) {
    await failDatasetAndThrow("FILE_NOT_FOUND", {
      httpStatusCode: 404,
      logDetails: { file_path: new_file_path }
    });
  }

  // 파일 다운로드
  const [fileBuffer] = await file.download();
  logInfo("[uploadDataset] New file downloaded", {
    tenant_id: tenant,
    function_name: "uploadDataset",
    extra: { file_path: new_file_path, file_size: fileBuffer.length }
  });

  // ========================================================================
  // 5. JSONL 파싱 (새 파일은 항상 JSONL)
  // ========================================================================
  let newRows;
  let datasetProfile = null;
  try {
    const jsonlText = fileBuffer.toString("utf-8");
    const parsed = parseJsonlToRows(jsonlText);
    if (hasJsonlParseIssues(parsed.issues)) {
      await failDatasetAndThrow("JSONL_PARSING_ERROR", {
        logDetails: {
          file_path: new_file_path,
          issues: parsed.issues
        }
      });
    }
    const { rows: processedRows } = handleDuplicateRowIds(parsed.rows);
    const profiled = buildDatasetProfile(processedRows);
    newRows = profiled.rows;
    datasetProfile = profiled.datasetProfile;
  } catch (parseError) {
    await failDatasetAndThrow(parseError?.errorCode || "JSONL_PARSING_ERROR", {
      originalError: parseError
    });
  }

  if (newRows.length === 0 && oldRows.length === 0) {
    await failDatasetAndThrow("NO_DATA_FOUND");
  }
  if (oldRows.length > 0 && newRows.length === 0) {
    await failDatasetAndThrow("ALL_ROWS_DELETED", {
      logDetails: {
        old_rows_count: oldRows.length,
        message: "All rows would be deleted. Use dataset delete API instead."
      }
    });
  }

  // ========================================================================
  // 6. 행 수 및 텍스트 길이 체크 (tenant quota 및 canonical 제한)
  // ========================================================================
  // MAX_ROWS: tenant의 quota.row_limit_per_dataset에서 가져옴 (기본값: 100)
  // MAX_TEXT_CHARS: 소스/언어와 무관한 canonical 제한
  //
  // 중요: 이 체크는 worker.js로 전달되기 전에 수행되므로,
  // worker.js에서는 체크하지 않고 검증된 JSONL 파일만 처리합니다.

  // 행 수 체크
  if (newRows.length > MAX_ROWS) {
    await failDatasetAndThrow("TOO_MANY_ROWS", {
      logDetails: { row_count: newRows.length, max_rows: MAX_ROWS }
    });
  }

  // 텍스트 길이 체크 (canonical 제한)
  for (let i = 0; i < newRows.length; i++) {
    const row = newRows[i];
    if (row.text && row.text.length > MAX_TEXT_CHARS) {
      await failDatasetAndThrow("TEXT_TOO_LONG", {
        logDetails: {
          row_index: i + 1,
          text_length: row.text.length,
          max_text_chars: MAX_TEXT_CHARS
        }
      });
    }
  }

  logInfo("[uploadDataset] New file parsed", {
    tenant_id: tenant,
    function_name: "uploadDataset",
    extra: {
      new_rows_count: newRows.length,
      old_rows_count: oldRows.length,
      dataset_profile_shape: datasetProfile?.shape || null,
      dataset_profile_signals: datasetProfile?.signals || null
    }
  });

  // 대표 벡터는 워커가 갱신한다. 증분 계산에 필요한 기존 평균은 보존한다.

  const buildDatasetMetadataPayload = (updatedAt) => {
    const payload = {
      dataset_id: finalDatasetId,
      tenant_id: tenant,
      name: name != null ? String(name).trim() || "" : "",
      source_type,
      source_ref: source_ref != null ? String(source_ref).trim() || "" : "",
      embed_model: embed_model,
      description: description || "",
      qdrant_url: qdrant_url,
      qdrant_collection: getQdrantCollectionName(tenant),
      rows: rowsParam,
      cols: colsParam,
      file_size: fileBuffer.length,
      dataset_profile: datasetProfile,
      updated_at: updatedAt
    };

    if (source_type === SourceType.GOOGLE_SHEETS) {
      if (spreadsheetIdBody != null && String(spreadsheetIdBody).trim()) {
        payload.spreadsheet_id = String(spreadsheetIdBody).trim();
      }
      if (sheetIdBody != null && String(sheetIdBody).trim()) {
        payload.sheet_id = String(sheetIdBody).trim();
      }
      if (spreadsheetNameBody != null && String(spreadsheetNameBody).trim()) {
        payload.spreadsheet_name = String(spreadsheetNameBody).trim();
      }
    }

    return payload;
  };

  // ========================================================================
  // 6. Diff 수행 (oldRows와 newRows 비교)
  // ========================================================================
  // row_id 기준으로 기본 비교하되, canonical text/meta가 달라지면 동일 row_id도 재-upsert 대상으로 본다.
  // - rowId는 컬럼 값 기반이므로 보통 내용 변경 시 rowId가 바뀌지만
  // - row-level meta/profile 추가처럼 payload만 달라지는 경우는 동일 rowId 재-upsert가 필요하다.
  // ========================================================================
  // oldRowMap과 newRowMap을 한 번만 생성하여 재사용
  const oldRowMap = new Map();
  oldRows.forEach((row) => oldRowMap.set(row.rowId, row));

  const newRowMap = new Map();
  newRows.forEach((row) => newRowMap.set(row.rowId, row));

  let toAdd = [];
  let toArchive = [];

  if (oldRows.length > 0) {
    // 새 row 또는 동일 rowId라도 canonical text/meta가 달라진 row를 재-upsert 대상으로 분류
    newRows.forEach((row) => {
      const oldRow = oldRowMap.get(row.rowId);
      if (!oldRow) {
        // 새로 추가된 row (rowId가 oldRowMap에 없음)
        toAdd.push(row);
        return;
      }
      if (getJsonlRowContentSignature(oldRow) !== getJsonlRowContentSignature(row)) {
        toAdd.push(row);
      }
    });

    // 삭제된 row (old에만 있는 row, rowId 기준)
    oldRows.forEach((row) => {
      if (!newRowMap.has(row.rowId)) {
        toArchive.push(row);
      }
    });
  } else {
    // actualOldJsonlPath가 없으면 전체를 새로 추가
    toAdd = newRows;
  }

  logInfo("[uploadDataset] Diff completed", {
    tenant_id: tenant,
    function_name: "uploadDataset",
    extra: {
      dataset_id: finalDatasetId,
      old_rows: oldRows.length,
      new_rows: newRows.length,
      to_add: toAdd.length,
      to_archive: toArchive.length
    }
  });

  // 이전 스냅샷과 추가·수정·삭제 차이가 없으면 메타데이터만 갱신하고 종료한다.
  if (
    oldRows.length > 0 &&
    toAdd.length === 0 &&
    toArchive.length === 0
  ) {
    let pending_tasks_count = 0;
    try {
      const n = await getWorkerPipelineCount(project_id);
      if (n !== null) pending_tasks_count = n;
    } catch {
      // 조회 실패 시 0 유지
    }

    logInfo("[uploadDataset] No changes vs previous JSONL, skipping GCS save and worker enqueue", {
      tenant_id: tenant,
      function_name: "uploadDataset",
      extra: {
        dataset_id: finalDatasetId,
        old_rows: oldRows.length,
        new_rows: newRows.length,
        pending_tasks_count
      }
    });

    const noChangeDatasetRef = store
      .collection(Collection.TENANTS)
      .doc(tenant)
      .collection(Collection.DATASETS)
      .doc(finalDatasetId);
    await noChangeDatasetRef.set(
      buildDatasetMetadataPayload(Date.now()),
      { merge: true }
    );

    return {
      success: true,
      synced: false,
      noChange: true,
      dataset_id: finalDatasetId,
      record_count: newRows.length,
      message: getLocalizedErrorMessage(locale, "SYNC_NO_CHANGES"),
      pending_tasks_count,
      estimated_completion_seconds: 0
    };
  }

  // ========================================================================
  // 7. JSONL 변환 및 GCS 저장 (2개 생성: 전체용 + 작업용)
  // ========================================================================
  // 7-1. 전체 JSONL (삭제 파악용): 전체 newRows 포함
  //      - 다음번 업로드 시 old_jsonl_path와 비교 가능
  //      - worker.js에서 삭제 대상 파악용
  // 7-2. 작업용 JSONL (실제 작업용): toAdd만 포함
  //      - worker.js에서 임베딩 생성 및 upsert 작업용
  //      - 변경되지 않은 row는 제외하여 비용 절감

  // 전체 newRows를 JSONL에 포함 (version 정보는 oldRowMap에서 가져옴)
  const rowsForFullJsonl = newRows.map((row) => {
    const oldRow = oldRowMap.get(row.rowId);
    if (oldRow) {
      // rowId가 같으면 내용도 같으므로 old의 version 유지
      return { ...row, version: oldRow.version || 1 };
    } else {
      // 새 row: version 1
      return { ...row, version: 1 };
    }
  });
  const fullJsonlContent = rowsForFullJsonl
    .map((row) => serializeJsonlRow(row))
    .join("\n");

  // 전체 JSONL 파일을 GCS에 저장 (삭제 파악용)
  const fullJsonlFileName = `datasets/${tenant}/${finalDatasetId}/${Date.now()}_full.jsonl`;
  const fullJsonlFile = storage.bucket(bucket).file(fullJsonlFileName);
  await fullJsonlFile.save(fullJsonlContent, {
    metadata: {
      contentType: "application/x-ndjson",
      metadata: {
        tenant,
        dataset_id: finalDatasetId,
        type: "full" // 삭제 파악용
      }
    }
  });

  const fullJsonlGcsPath = `gs://${bucket}/${fullJsonlFileName}`;
  logInfo("[uploadDataset] Full JSONL saved to GCS", {
    tenant_id: tenant,
    function_name: "uploadDataset",
    extra: {
      jsonl_path: fullJsonlGcsPath,
      rows_count: rowsForFullJsonl.length
    }
  });

  // 작업용 JSONL: toAdd만 포함 (변경되지 않은 row 제외)
  const rowsForWorkerJsonl = toAdd.map((row) => {
    // 새 row: version 1
    return { ...row, version: 1 };
  });
  const workerJsonlContent = rowsForWorkerJsonl
    .map((row) => serializeJsonlRow(row))
    .join("\n");

  // 작업용 JSONL 파일을 GCS에 저장 (실제 작업용)
  const workerJsonlFileName = `datasets/${tenant}/${finalDatasetId}/${Date.now()}_worker.jsonl`;
  const workerJsonlFile = storage.bucket(bucket).file(workerJsonlFileName);
  await workerJsonlFile.save(workerJsonlContent, {
    metadata: {
      contentType: "application/x-ndjson",
      metadata: {
        tenant,
        dataset_id: finalDatasetId,
        type: "worker" // 실제 작업용
      }
    }
  });

  const workerJsonlGcsPath = `gs://${bucket}/${workerJsonlFileName}`;
  logInfo("[uploadDataset] Worker JSONL saved to GCS", {
    tenant_id: tenant,
    function_name: "uploadDataset",
    extra: {
      jsonl_path: workerJsonlGcsPath,
      rows_count: rowsForWorkerJsonl.length,
      to_add: toAdd.length
    }
  });

  // ========================================================================
  // 8. 토큰 한도 체크 (dataset 문서 업데이트 전에 수행, streamChatRag와 동일)
  // ========================================================================
  // billing month 기준 token_used_billing_month vs 한도(기본+addon) 체크.
  // 워커는 임베딩 생성 시 토큰을 사용하므로, 한도 초과 시 dataset 문서를 생성/업데이트하지 않고 즉시 실패 처리합니다.
  const quotaCheckResult = await checkTokenLimit(tenant, {
    locale,
    tenantData: tenantData // 이미 읽은 tenant 데이터 전달 (중복 쿼리 방지)
  });

  logInfo("[uploadDataset] Quota check", {
    tenant_id: tenant,
    function_name: "uploadDataset",
    extra: { dataset_id: finalDatasetId, details: quotaCheckResult.details }
  });

  if (quotaCheckResult.exceeded) {
    await failDatasetAndThrow("QUOTA_EXCEEDED", {
      httpStatusCode: 429,
      logDetails: quotaCheckResult.details,
      returnToUser: true,
      details: quotaCheckResult.details,
      localizedErrorKey: "QUOTA_EXCEEDED_TOKEN" // streamChatRag와 동일 메시지 ("월 토큰 한도를 초과했습니다.")
    });
  }

  // ========================================================================
  // 9·10. Dataset 문서 업데이트: 작업 소유권 선점 → enqueue → 조건부 메타데이터 보강
  // ========================================================================
  // 중요: fullJsonlGcsPath는 GCS에만 저장하고 Firestore에는 저장하지 않음
  // worker.js에서 작업이 완료된 후에만 Firestore에 jsonl_paths 저장 (데이터 일관성)
  // rows, cols, pending_tasks_count 등은 아래 datasetPayload로 한 번에 set

  logInfo("[uploadDataset] JSONL saved to GCS, enqueueing worker task", {
    tenant_id: tenant,
    function_name: "uploadDataset",
    extra: {
      dataset_id: finalDatasetId,
      worker_jsonl_path: workerJsonlGcsPath,
      full_jsonl_path: fullJsonlGcsPath
    }
  });
  const processingJobId = createIngestJobId({
    tenant,
    datasetId: finalDatasetId,
    fullGcsPath: fullJsonlGcsPath,
    workerGcsPath: workerJsonlGcsPath
  });
  activeProcessingJobId = processingJobId;
  const processingStartedAt = Date.now();

  // enqueue 전에 작업 ID를 영속화해야 빠르게 시작한 worker가 같은 ID로 락을 획득할 수 있다.
  await store.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(datasetRef);
    const currentData = snapshot.exists ? snapshot.data() : {};
    const currentStatus = currentData?.status;
    const currentJobId = currentData?.processing_job_id;
    const currentUpdatedAt = currentData?.updated_at;
    const currentUpdatedAtMs =
      typeof currentUpdatedAt === "number"
        ? currentUpdatedAt
        : typeof currentUpdatedAt?.toMillis === "function"
          ? currentUpdatedAt.toMillis()
          : null;
    const isActive =
      currentStatus === DatasetStatus.PROCESSING ||
      currentStatus === DatasetStatus.INDEXING;
    const isRecentOrUnknown =
      currentUpdatedAtMs == null ||
      Date.now() - currentUpdatedAtMs < 30 * 60 * 1000;

    if (
      isActive &&
      isRecentOrUnknown &&
      currentJobId !== processingJobId
    ) {
      throw new ApiError({
        errorCode: "DATASET_PROCESSING",
        message: "This dataset is already being processed.",
        httpStatusCode: 409,
        returnToUser: true
      });
    }

    const initialPayload = {
      ...buildDatasetMetadataPayload(processingStartedAt),
      status: DatasetStatus.PROCESSING,
      processing_job_id: processingJobId,
      started_at: processingStartedAt,
      updated_at: processingStartedAt
    };
    if (!snapshot.exists) initialPayload.created_at = processingStartedAt;
    transaction.set(datasetRef, initialPayload, { merge: true });
  });

  try {
    const enqueueResult = await enqueueWorkerTask({
      tenant,
      dataset: finalDatasetId,
      job_id: processingJobId,
      gcs_path: workerJsonlGcsPath,
      full_gcs_path: fullJsonlGcsPath,
      qdrant_url,
      embed_model,
      vector_size,
      project_id,
      dataset_locale: locale
    });
    if (enqueueResult?.job_id !== processingJobId) {
      throw new Error(
        `Worker enqueue returned an unexpected job_id: ${enqueueResult?.job_id || "missing"}`
      );
    }
    logInfo("[uploadDataset] Worker task enqueued successfully", {
      tenant_id: tenant,
      function_name: "uploadDataset",
      extra: {
        dataset_id: finalDatasetId,
        job_id: enqueueResult?.job_id || processingJobId,
        full_jsonl_path: fullJsonlGcsPath,
        worker_jsonl_path: workerJsonlGcsPath
      }
    });
  } catch (enqueueError) {
    await failDatasetAndThrow("WORKER_ENQUEUE_FAILED", {
      httpStatusCode: 502,
      logDetails: {
        worker_jsonl_path: workerJsonlGcsPath,
        full_jsonl_path: fullJsonlGcsPath,
        project_id,
        embed_model,
        vector_size,
        error_message: enqueueError?.message || String(enqueueError),
        error_name: enqueueError?.name,
        error_code: enqueueError?.code,
        error_stack: enqueueError?.stack
      }
    });
  }
  let pending_tasks_count = 0;
  try {
    const n = await getWorkerPipelineCount(project_id);
    if (n !== null) pending_tasks_count = n;
  } catch {
    // 조회 실패 시 0 유지
  }

  const now = Date.now();
  const estimated_completion_seconds = estimateIngestCompletionSeconds({
    rowsToEmbed: toAdd.length,
    rowsToDelete: toArchive.length,
    pendingTasksCount: pending_tasks_count || 1
  });
  const datasetPayload = {
    ...buildDatasetMetadataPayload(now),
    pending_tasks_count, // 업로드 시점 큐 대기(및 처리 중) 태스크 수
    estimated_completion_seconds,
    estimated_completion_at: now + estimated_completion_seconds * 1000,
    updated_at: now
  };

  // worker가 이미 INDEXING/READY로 진행했으면 상태를 되돌리지 않는다.
  // 메타데이터와 pending count도 이 업로드가 여전히 소유한 경우에만 기록한다.
  await store.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(datasetRef);
    if (
      !snapshot.exists ||
      snapshot.data()?.processing_job_id !== processingJobId
    ) {
      return;
    }
    transaction.set(datasetRef, datasetPayload, { merge: true });
  });

  // google_sheets일 때 refresh_token이 있으면 AES 암호화하여 tenant 문서에 저장 (수동/자동 동기화 시 복호화하여 사용)
  const refreshTokenRaw =
    refreshTokenBody != null && typeof refreshTokenBody === "string"
      ? refreshTokenBody.trim()
      : "";
  if (source_type === SourceType.GOOGLE_SHEETS && refreshTokenRaw.length > 0) {
    try {
      const tenantRef = store.collection(Collection.TENANTS).doc(tenant);
      await tenantRef.set(
        { google_sheets_refresh_token_encrypted: encrypt(refreshTokenRaw) },
        { merge: true }
      );
    } catch (encErr) {
      logWarn(
        "[uploadDataset] Failed to encrypt/save refresh_token to tenant, skipping",
        {
          tenant_id: tenant,
          function_name: "uploadDataset",
          extra: {
            dataset_id: finalDatasetId,
            error: encErr?.message || String(encErr)
          }
        }
      );
    }
  }

  logInfo(
    "[uploadDataset] Dataset document updated (jsonl_paths will be updated by worker.js after completion)",
    {
      tenant_id: tenant,
      function_name: "uploadDataset",
      extra: {
        dataset_id: finalDatasetId,
        full_jsonl_path: fullJsonlGcsPath,
        worker_jsonl_path: workerJsonlGcsPath,
        old_jsonl_path: actualOldJsonlPath || "none"
      }
    }
  );

  // 성공 메시지 다국어 처리
  const successMessage = getDatasetSuccessMessage(locale, "upload");
  // 월별 감사: uploadDataset 자체는 토큰 미사용(worker에서 임베딩), usages 없음 → scheduleAuditMonthlyAfterResponse 호출 생략

  return {
    success: true,
    dataset_id: finalDatasetId,
    record_count: newRows.length,
    full_jsonl_path: fullJsonlGcsPath, // 전체 JSONL 경로 (다음번 비교용, worker.js 완료 후 Firestore에 저장)
    worker_jsonl_path: workerJsonlGcsPath, // 작업용 JSONL 경로 (변경된 row만)
    pending_tasks_count, // 큐에 대기 중인(및 처리 중인) 태스크 수
    estimated_completion_seconds,
    estimated_completion_at: now + estimated_completion_seconds * 1000,
    message: successMessage
  };
}

module.exports = { uploadDataset, runUploadDataset };