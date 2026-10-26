/**
 * ============================================================================
 * ingest-worker (tenant + dataset-aware) — Incremental Upsert/Delete
 * ============================================================================
 *
 * 이 워커는 GCS(Google Cloud Storage)에 저장된 JSONL 파일을 읽어서
 * 텍스트를 임베딩 벡터로 변환하고 Qdrant 벡터 데이터베이스에 저장합니다.
 *
 * 주요 특징:
 * 1) Incremental Upsert/Delete 방식
 *    - 기존 row_id와 비교하여 추가/삭제 분류
 *    - 삭제된 row는 Qdrant에서 삭제 (JSONL로 관리, Firestore 불필요)
 *    - 새 row는 Qdrant에 upsert
 *    - 참고: rowId는 컬럼 값 기반이므로, 컬럼 값이 변경되면 rowId가 변경되어 삭제 후 추가로 처리됨 (업데이트 없음)
 *
 * 2) Qdrant 컬렉션은 tenant 단위 1개: {base}__{tenant}
 *    예: base="cm_chunks", tenant="hadfamily" → collection="cm_chunks__hadfamily"
 *    - dataset은 payload로 구분해서 filter로 조회
 *    - 하나의 컬렉션에 여러 dataset의 데이터가 저장됨
 *
 * 3) 임베딩 모델은 execute 시 env로 받음 (EMBED_MODEL)
 *    예: "text-embedding-3-small", "text-embedding-3-large"
 *
 * 4) Qdrant payload에 원문(text) + 정규화 텍스트(embedding_text) + version + light row meta 저장
 *    - payload: tenant, dataset, row_id, embed_model, text, embedding_text, version, row_kind_guess, is_long_text, has_section_marker, policy_like, faq_like
 *    - 원문 텍스트와 버전을 payload에 저장하여 RAG 검색 시 Firestore 조회 불필요
 *    - 검색 성능 향상 및 네트워크 호출 감소
 *
 * 5) QDRANT_URL 필수 환경변수로 지정
 *    예: "http://localhost:6333" 또는 "https://qdrant.example.com"
 *
 * 5b) DATASET_LOCALE (선택): 테넌트 언어(ko, en, …). Cloud Functions가 enqueue 시 전달.
 *     실패 시 Firestore dataset.error에 이 locale로 사용자용 문구를 저장합니다.
 *
 * 6) 검증 및 체크
 *    - uploadDataset.js에서 이미 토큰 한도, MAX_ROWS, MAX_TEXT_CHARS 체크 완료
 *    - worker.js에서는 canonical JSONL 재검증과 delete-only/no-op 가드를 추가로 수행
 *
 * 실행:
 * - uploadDataset.js에서 executeWorker 함수를 통해 Cloud Run Job으로 실행됨
 * - 독립적으로 실행되지 않음
 *
 * 처리 흐름:
 * 1. 환경변수 읽기 및 검증
 * 2. Dataset 상태 업데이트: indexing
 * 3. GCS에서 JSONL 파일 다운로드
 *    - GCS_PATH: 실제 작업용 (toAdd만, 새로 추가된 row만)
 *    - FULL_GCS_PATH: 삭제 파악용 (전체 newRows, 있으면 사용)
 * 3.5. Qdrant 컬렉션 확인/생성 (없으면 생성, 신규 tenant 시 scroll 404 방지)
 * 4. JSONL 파싱 (row_id, text, version, optional meta 추출 및 canonical 검증)
 * 5. Qdrant에서 기존 row_id 조회
 * 6. 추가/업데이트/삭제 분류
 *    - 삭제: FULL_GCS_PATH (또는 GCS_PATH)에 없는 row_id
 *    - 추가/업데이트: GCS_PATH의 모든 row (변경된 것만)
 * 7. 텍스트를 임베딩 벡터로 변환 (배치 처리, 변경된 row만)
 * 8. Qdrant 컬렉션 확인/생성
 * 9. 삭제된 row 처리 (Qdrant에서 삭제)
 * 10. 새 row upsert
 * 11. Dataset 상태 업데이트: ready (작업 완료)
 * 12. jsonl_paths 저장 (작업 성공 시에만, 다음번 업로드 시 oldJsonlPath로 사용)
 * ============================================================================
 */

const crypto = require("crypto");
const OpenAIModule = require("openai");
const OpenAI = OpenAIModule.default || OpenAIModule;
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const readline = require("readline");
const { storage } = require("../firebase");
const {
  captureError,
  captureMessage,
  flushSentry
} = require("../utils/sentry");
const {
  getWorkerLocalizedDatasetError,
  normalizeWorkerLocale
} = require("./workerDatasetErrors");

function sanitizeUrlForLog(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    // 절대 사용자/비번/쿼리/프래그먼트를 로그에 남기지 않음
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch (_) {
    // URL() 파싱이 실패하면 원문 일부만 (길이 제한)
    return s.slice(0, 200);
  }
}

// ============================================================================
// Dataset 상태 상수
// ============================================================================
// cloud functions/const/DatasetStatus.js와 동일한 값 사용
const DatasetStatus = {
  /** 큐 등록 완료, worker 시작 대기 중 */
  PROCESSING: "processing",
  /** 인덱싱 중 (임베딩 생성 및 Qdrant 저장 진행 중) */
  INDEXING: "indexing",
  /** 준비 완료 (인덱싱 완료, 사용 가능) */
  READY: "ready",
  /** 실패 (에러 발생 또는 처리 실패) */
  FAILED: "failed",
  /** 일시중지됨 (검색/대화 대상에서 제외) */
  PAUSED: "paused",
  /** 삭제됨 (데이터셋이 삭제됨) */
  DELETED: "deleted"
};

// ============================================================================
// Sentry 노이즈/비용 제어 (Functions 공용 Sentry 인스턴스 사용)
// ============================================================================
const __sentryLastSentAtByKey = new Map();

function shouldSendSentry({ key, sampleRate = 1.0, cooldownMs = 0 }) {
  if (!key) return true;
  const now = Date.now();
  const last = __sentryLastSentAtByKey.get(key) || 0;
  if (cooldownMs > 0 && now - last < cooldownMs) return false;
  if (sampleRate < 1.0 && Math.random() > sampleRate) return false;
  __sentryLastSentAtByKey.set(key, now);
  return true;
}

function captureErrorThrottled(error, context = {}, throttling = {}) {
  const key = throttling.key || context?.extra?.sentry_key || null;
  const sampleRate = throttling.sampleRate != null ? throttling.sampleRate : 1.0;
  const cooldownMs = throttling.cooldownMs != null ? throttling.cooldownMs : 0;
  if (!shouldSendSentry({ key, sampleRate, cooldownMs })) return;
  captureError(error, context);
}

// ============================================================================
// Billing Window 계산 유틸리티
// ============================================================================

/**
 * 현재 월에서 startDay에 해당하는 날짜를 찾거나, 없으면 이전 가능한 날짜로 조정
 * @param {Date} now - 현재 시간
 * @param {number} startDay - 원하는 일자 (1-31)
 * @returns {Date} - 조정된 날짜
 */
function adjustDayInMonth(now, startDay) {
  const year = now.getFullYear();
  const month = now.getMonth();

  // 해당 월의 마지막 날짜 확인
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  // startDay가 해당 월에 존재하는지 확인
  let targetDay = startDay;
  if (startDay > lastDayOfMonth) {
    // startDay가 해당 월에 없으면 마지막 날짜로 조정
    targetDay = lastDayOfMonth;
  }

  return new Date(year, month, targetDay);
}

/**
 * billing window 계산
 * @param {Date} now - 현재 시간
 * @param {number} startDay - 빌링 시작일 (1-31)
 * @param {Date|null} existingWindowStartAt - 기존 windowStartAt (시,분,초 유지용)
 * @returns {{windowStartAt: Date, windowEndAt: Date}} - 계산된 window
 */
function calculateBillingWindow(now, startDay, existingWindowStartAt = null) {
  // 현재 월의 startDay 날짜 계산 (없으면 조정)
  const currentMonthStart = adjustDayInMonth(now, startDay);

  // windowStartAt: 현재 월의 startDay
  let windowStartAt = new Date(currentMonthStart);

  // 기존 windowStartAt이 있으면 시,분,초 유지 (Date 객체로 전달됨)
  if (existingWindowStartAt) {
    const existingDate = existingWindowStartAt instanceof Date
      ? existingWindowStartAt
      : new Date(existingWindowStartAt);
    windowStartAt.setHours(existingDate.getHours());
    windowStartAt.setMinutes(existingDate.getMinutes());
    windowStartAt.setSeconds(existingDate.getSeconds());
    windowStartAt.setMilliseconds(existingDate.getMilliseconds());
  } else {
    // 기존 값이 없으면 00:00:00으로 설정
    windowStartAt.setHours(0, 0, 0, 0);
  }

  // windowEndAt: 다음 달의 startDay (없으면 조정)
  const nextMonth = new Date(currentMonthStart);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStart = adjustDayInMonth(nextMonth, startDay);

  let windowEndAt = new Date(nextMonthStart);
  // windowEndAt의 시,분,초는 windowStartAt과 동일하게 설정
  windowEndAt.setHours(windowStartAt.getHours());
  windowEndAt.setMinutes(windowStartAt.getMinutes());
  windowEndAt.setSeconds(windowStartAt.getSeconds());
  windowEndAt.setMilliseconds(windowStartAt.getMilliseconds());

  return {
    windowStartAt,
    windowEndAt
  };
}

/**
 * billing window가 만료되었는지 확인
 * @param {number|Date} windowEndAt - window 종료 시간 (timestamp 또는 Date)
 * @param {Date} now - 현재 시간
 * @returns {boolean} - 만료 여부
 */
function isBillingWindowExpired(windowEndAt, now) {
  const endTime =
    windowEndAt instanceof Date
      ? windowEndAt.getTime()
      : typeof windowEndAt === "number"
        ? windowEndAt
        : new Date(windowEndAt).getTime();
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return nowTime >= endTime;
}

/**
 * billingKey 생성
 * @param {number|Date} windowStartAt - window 시작 시간
 * @param {number|Date} windowEndAt - window 종료 시간
 * @returns {string} - billingKey (예: "1767686567271_1767686567272")
 */
function generateBillingKey(windowStartAt, windowEndAt) {
  const startTime =
    windowStartAt instanceof Date
      ? windowStartAt.getTime()
      : typeof windowStartAt === "number"
        ? windowStartAt
        : new Date(windowStartAt).getTime();
  const endTime =
    windowEndAt instanceof Date
      ? windowEndAt.getTime()
      : typeof windowEndAt === "number"
        ? windowEndAt
        : new Date(windowEndAt).getTime();
  return `${startTime}_${endTime}`;
}

/**
 * 날짜를 YYYY-MM-DD 형식으로 변환
 * @param {Date} date - 날짜
 * @returns {string} - YYYY-MM-DD 형식 문자열
 */
function formatDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ============================================================================
// 애드온 토큰 관리 함수들
// ============================================================================

/**
 * F2) 현재 애드온 "잔액(사용 가능 토큰)" 계산
 * @param {Array} addonTokenArray - addon_token 배열
 * @param {number} currentTime - 현재 시간 (timestamp, milliseconds)
 * @returns {number} - 사용 가능한 애드온 토큰 총합
 */
function getAddonAvailableTokens(addonTokenArray, currentTime = Date.now()) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0) {
    return 0;
  }

  return addonTokenArray
    .filter((addon) => {
      if (!addon) return false;

      const isActive = addon.status === "active";
      const isNotExpired =
        addon.active_pack_expires_at &&
        addon.active_pack_expires_at > currentTime;

      return isActive && isNotExpired;
    })
    .reduce((sum, addon) => {
      const balance = addon.token_balance || 0;
      const used = addon.token_used || 0;
      const available = Math.max(0, balance - used);
      return sum + available;
    }, 0);
}

/**
 * F5) 만료 처리 - 만료된 애드온의 status를 "expired"로 변경
 * @param {Array} addonTokenArray - addon_token 배열
 * @param {number} currentTime - 현재 시간 (timestamp, milliseconds)
 * @returns {Array} - 업데이트된 addon_token 배열
 */
function processAddonExpiration(addonTokenArray, currentTime = Date.now()) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0) {
    return addonTokenArray;
  }

  let hasChanges = false;
  const updated = addonTokenArray.map((addon) => {
    if (!addon) return addon;

    if (
      addon.status === "active" &&
      addon.active_pack_expires_at &&
      addon.active_pack_expires_at <= currentTime
    ) {
      hasChanges = true;
      return {
        ...addon,
        status: "expired",
        updated_at: currentTime
      };
    }

    return addon;
  });

  return hasChanges ? updated : addonTokenArray;
}

/**
 * F6) 소진 처리 - 소진된 애드온의 status를 "depleted"로 변경
 * @param {Array} addonTokenArray - addon_token 배열
 * @returns {Array} - 업데이트된 addon_token 배열
 */
function processAddonDepletion(addonTokenArray) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0) {
    return addonTokenArray;
  }

  let hasChanges = false;
  const currentTime = Date.now();

  const updated = addonTokenArray.map((addon) => {
    if (!addon) return addon;

    const balance = addon.token_balance || 0;
    const used = addon.token_used || 0;

    if (addon.status === "active" && used >= balance) {
      hasChanges = true;
      return {
        ...addon,
        status: "depleted",
        updated_at: currentTime
      };
    }

    return addon;
  });

  return hasChanges ? updated : addonTokenArray;
}

/**
 * 만료 및 소진 처리 (F5 + F6)
 * @param {Array} addonTokenArray - addon_token 배열
 * @param {number} currentTime - 현재 시간 (timestamp, milliseconds)
 * @returns {Array} - 업데이트된 addon_token 배열
 */
function processAddonStatus(addonTokenArray, currentTime = Date.now()) {
  let updated = processAddonExpiration(addonTokenArray, currentTime);
  updated = processAddonDepletion(updated);
  return updated;
}

/**
 * 애드온 토큰 사용 처리
 * @param {Array} addonTokenArray - addon_token 배열
 * @param {number} tokenCount - 사용할 토큰 수
 * @param {number} currentTime - 현재 시간 (timestamp, milliseconds)
 * @returns {Object} - { updated: Array, usedFromAddon: number, remaining: number }
 */
function consumeAddonTokens(
  addonTokenArray,
  tokenCount,
  currentTime = Date.now()
) {
  if (
    !Array.isArray(addonTokenArray) ||
    addonTokenArray.length === 0 ||
    tokenCount <= 0
  ) {
    return {
      updated: addonTokenArray || [],
      usedFromAddon: 0,
      remaining: tokenCount
    };
  }

  const activeAddons = addonTokenArray
    .map((addon, index) => ({ addon, index }))
    .filter(({ addon }) => {
      if (!addon) return false;
      const isActive = addon.status === "active";
      const isNotExpired =
        addon.active_pack_expires_at &&
        addon.active_pack_expires_at > currentTime;
      const hasBalance =
        (addon.token_balance || 0) - (addon.token_used || 0) > 0;
      return isActive && isNotExpired && hasBalance;
    })
    .sort((a, b) => {
      const expiresA = a.addon.active_pack_expires_at || 0;
      const expiresB = b.addon.active_pack_expires_at || 0;
      return expiresA - expiresB;
    });

  if (activeAddons.length === 0) {
    return {
      updated: addonTokenArray,
      usedFromAddon: 0,
      remaining: tokenCount
    };
  }

  let remaining = tokenCount;
  let usedFromAddon = 0;
  const updated = [...addonTokenArray];

  for (const { addon, index } of activeAddons) {
    if (remaining <= 0) break;

    const balance = addon.token_balance || 0;
    const used = addon.token_used || 0;
    const available = balance - used;

    if (available > 0) {
      const toUse = Math.min(remaining, available);
      const newUsed = used + toUse;

      updated[index] = {
        ...addon,
        token_used: newUsed,
        updated_at: currentTime,
        status: newUsed >= balance ? "depleted" : addon.status
      };

      usedFromAddon += toUse;
      remaining -= toUse;
    }
  }

  return {
    updated,
    usedFromAddon,
    remaining
  };
}

// ============================================================================
// 헬퍼 함수들
// ============================================================================

/**
 * GCS 경로 파싱
 * GCS 경로를 bucket과 file name으로 분리합니다.
 *
 * @param {string} gsPath - GCS 경로 (예: "gs://bucket-name/path/to/file.jsonl")
 * @returns {{bucket: string, name: string}} - bucket 이름과 파일 경로
 * @throws {Error} - 유효하지 않은 경로인 경우
 *
 * 예시:
 * parseGsPath("gs://my-bucket/data/file.jsonl")
 * → { bucket: "my-bucket", name: "data/file.jsonl" }
 */
function parseGsPath(gsPath) {
  const m = gsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Invalid GCS_PATH: ${gsPath}`);
  return { bucket: m[1], name: m[2] };
}

function buildCanonicalRowFromJsonlObject(obj) {
  const rowId = String(obj?.row_id ?? "").trim();
  const text = String(obj?.text ?? "").trim();
  const parsedVersion = Number(obj?.version);
  const version =
    parsedVersion > 0 && Number.isInteger(parsedVersion) ? parsedVersion : 1;
  const rowMeta =
    obj?.meta && typeof obj.meta === "object" && !Array.isArray(obj.meta)
      ? {
        row_kind_guess:
          typeof obj.meta.row_kind_guess === "string"
            ? obj.meta.row_kind_guess
            : "unknown",
        is_long_text: obj.meta.is_long_text === true,
        has_section_marker: obj.meta.has_section_marker === true,
        policy_like: obj.meta.policy_like === true,
        faq_like: obj.meta.faq_like === true,
        list_like: obj.meta.list_like === true,
        record_like: obj.meta.record_like === true
      }
      : null;
  if (!rowId) return { row: null, reason: "missing_row_id" };
  if (!text) return { row: null, reason: "missing_text" };
  return {
    row: {
      rowId,
      text,
      version,
      rowMeta
    },
    reason: null
  };
}

/**
 * GCS의 JSONL을 스트리밍으로 읽어 rows(row_id, text, version) 배열로 변환
 * - 메모리 사용량을 줄이기 위해 전체 다운로드 대신 createReadStream + readline 사용
 */
async function readJsonlRowsFromGcs(storage, gsPath, tenantId = null, datasetId = null) {
  try {
    const { bucket, name } = parseGsPath(gsPath);
    const stream = storage.bucket(bucket).file(name).createReadStream();
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const rows = [];
    const issues = {
      invalid_json_lines: 0,
      missing_row_id_lines: 0,
      missing_text_lines: 0
    };
    for await (const line of rl) {
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;
      const obj = safeJsonParse(trimmed);
      if (!obj) {
        issues.invalid_json_lines += 1;
        continue;
      }
      const parsed = buildCanonicalRowFromJsonlObject(obj);
      if (!parsed.row) {
        if (parsed.reason === "missing_row_id") issues.missing_row_id_lines += 1;
        if (parsed.reason === "missing_text") issues.missing_text_lines += 1;
        continue;
      }
      rows.push(parsed.row);
    }
    if (
      issues.invalid_json_lines > 0 ||
      issues.missing_row_id_lines > 0 ||
      issues.missing_text_lines > 0
    ) {
      throw new Error(
        `Invalid canonical JSONL rows detected: ${JSON.stringify(issues)}`
      );
    }
    return rows;
  } catch (e) {
    const err = new Error(
      `Failed to read JSONL from GCS (rows): ${gsPath}. ${e?.message || String(e)}`
    );
    err.cause = e;
    captureErrorThrottled(err, {
      tenant_id: tenantId || "empty",
      function_name: "readJsonlRowsFromGcs",
      extra: {
        dataset_id: datasetId || null,
        gs_path: gsPath,
        operation: "gcs_jsonl_stream_rows"
      }
    }, { key: `gcs_jsonl_rows:${tenantId || "empty"}:${gsPath}`, cooldownMs: 30_000 });
    throw err;
  }
}

/**
 * GCS의 JSONL을 스트리밍으로 읽어 row_id Set + valid rows count만 수집
 * - FULL_GCS_PATH(삭제 파악용)에서 text를 굳이 메모리에 올리지 않기 위함
 */
async function readJsonlRowIdsAndCountFromGcs(storage, gsPath, tenantId = null, datasetId = null) {
  try {
    const { bucket, name } = parseGsPath(gsPath);
    const stream = storage.bucket(bucket).file(name).createReadStream();
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const rowIds = new Set();
    let rowsCount = 0;
    const issues = {
      invalid_json_lines: 0,
      missing_row_id_lines: 0,
      missing_text_lines: 0
    };
    for await (const line of rl) {
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;
      const obj = safeJsonParse(trimmed);
      if (!obj) {
        issues.invalid_json_lines += 1;
        continue;
      }
      const parsed = buildCanonicalRowFromJsonlObject(obj);
      if (!parsed.row) {
        if (parsed.reason === "missing_row_id") issues.missing_row_id_lines += 1;
        if (parsed.reason === "missing_text") issues.missing_text_lines += 1;
        continue;
      }
      rowIds.add(parsed.row.rowId);
      rowsCount += 1;
    }
    if (
      issues.invalid_json_lines > 0 ||
      issues.missing_row_id_lines > 0 ||
      issues.missing_text_lines > 0
    ) {
      throw new Error(
        `Invalid canonical JSONL rows detected: ${JSON.stringify(issues)}`
      );
    }
    return { rowIds, rowsCount };
  } catch (e) {
    const err = new Error(
      `Failed to read JSONL from GCS (row_ids): ${gsPath}. ${e?.message || String(e)}`
    );
    err.cause = e;
    captureErrorThrottled(err, {
      tenant_id: tenantId || "empty",
      function_name: "readJsonlRowIdsAndCountFromGcs",
      extra: {
        dataset_id: datasetId || null,
        gs_path: gsPath,
        operation: "gcs_jsonl_stream_row_ids"
      }
    }, { key: `gcs_jsonl_rowids:${tenantId || "empty"}:${gsPath}`, cooldownMs: 30_000 });
    throw err;
  }
}

/**
 * 16진수 문자열을 UUID 형식으로 변환 (결정적)
 * 16진수 문자열(32자리 또는 40자리)을 UUID 형식으로 변환합니다.
 * Qdrant는 UUID 또는 uint만 지원하므로 이 변환이 필요합니다.
 *
 * @param {string} hex - 16진수 문자열 (32자리 또는 40자리)
 * @returns {string} - UUID 형식 문자열 (예: "550e8400-e29b-41d4-a716-446655440000")
 *
 * 예시:
 * hexToUuid("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d") // 40자리
 * → "aaf4c61d-dcc5-e8a2-dabe-de0f3b482cd9"
 * hexToUuid("aaf4c61ddcc5e8a2dabede0f3b482cd") // 32자리
 * → "aaf4c61d-dcc5-e8a2-dabe-de0f3b482cd"
 */
function hexToUuid(hex) {
  const raw = String(hex || "");
  const isHex = /^[0-9a-f]+$/i.test(raw);
  // hex가 아니면 sha256으로 결정적 hex 생성 (UUID 형식 보장)
  const normalizedHex = isHex
    ? raw
    : crypto.createHash("sha256").update(raw).digest("hex");
  const h = normalizedHex.slice(0, 32).padEnd(32, "0"); // 32자리로 맞춤 (부족하면 0으로 채움)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(
    16,
    20
  )}-${h.slice(20, 32)}`;
}

/**
 * 컬렉션 이름 안전화
 * 문자열을 Qdrant 컬렉션 이름으로 사용할 수 있도록 안전화합니다.
 * - 소문자로 변환
 * - 영문자, 숫자, 언더스코어만 허용 (나머지는 언더스코어로 변환)
 * - 앞뒤 언더스코어 제거
 * - 최대 60자로 제한
 *
 * @param {string} s - 원본 문자열
 * @returns {string} - 안전화된 컬렉션 이름
 *
 * 예시:
 * toSafeCollectionName("My-Tenant@123")
 * → "my_tenant_123"
 *
 * toSafeCollectionName("  HadFamily  ")
 * → "hadfamily"
 */
function toSafeCollectionName(s) {
  return (s || "")
    .toLowerCase() // 소문자 변환
    .replace(/[^a-z0-9_]+/g, "_") // 특수문자를 언더스코어로 변환
    .replace(/^_+|_+$/g, "") // 앞뒤 언더스코어 제거
    .slice(0, 60); // 최대 60자로 제한
}

/**
 * BM25용 sparse 벡터 생성 (worker와 cloud functions에서 동일 로직 사용)
 * 토큰화 후 term -> (index, weight) 매핑. index는 해시 기반 uint32, weight는 1+log(tf).
 *
 * @param {string} text - 원문
 * @returns {{ indices: number[], values: number[] }} - Qdrant sparse 형식 (indices 오름차순)
 */
function textToBm25Sparse(text) {
  if (!text || typeof text !== "string") {
    return { indices: [], values: [] };
  }
  // 다국어/혼합 언어 대응 토큰화:
  // - Latin(영/유럽권): 악센트 폴딩 + [a-z0-9] 단어 토큰 (길이>=2)
  // - Hangul(한국어): 한글 토큰 (길이>=1)
  // - CJK(일/중): 공백이 없을 수 있어 문자 bigram + 짧은 시퀀스 토큰을 함께 사용
  // ⚠️ cloud functions/utils/qdrant.js와 반드시 동일 로직 유지
  const MAX_TOKENS = 512; // 과도한 토큰 폭주 방지
  const MAX_CJK_NGRAMS = 384;
  const MAX_LATIN_TOKENS = 192;
  const MAX_HANGUL_TOKENS = 192;

  const nfkc = text.normalize("NFKC").toLowerCase();

  // Latin: NFKD로 악센트 분해 후 결합문자 제거 → é/ö/ñ 등 폴딩
  const latinFold = nfkc.normalize("NFKD").replace(/\p{M}+/gu, "");
  const latinTokensRaw = latinFold.match(/[a-z0-9]{2,}/g) || [];
  const latinTokens = latinTokensRaw.slice(0, MAX_LATIN_TOKENS);

  // Hangul: 한글(가-힣) + 숫자 조합 토큰
  const hangulTokensRaw = nfkc.match(/[가-힣0-9]+/g) || [];
  const hangulTokens = hangulTokensRaw
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, MAX_HANGUL_TOKENS);

  // CJK 시퀀스(히라가나/가타카나/한자/반각 가타카나)
  const cjkSeqs =
    nfkc.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff65-\uff9f]+/g) ||
    [];
  const cjkTokens = [];
  let cjkNgrams = 0;
  for (const seq of cjkSeqs) {
    const s = String(seq || "").trim();
    if (!s) continue;

    // 짧은 구간은 그대로 토큰으로 추가 (예: ダッシュボード, 設定 등)
    if (s.length >= 2 && s.length <= 12) cjkTokens.push(s);
    if (s.length === 1) cjkTokens.push(s);

    // 문자 bigram (CJK 전용 폴백)
    for (let i = 0; i < s.length - 1; i++) {
      cjkTokens.push(s.slice(i, i + 2));
      cjkNgrams++;
      if (cjkNgrams >= MAX_CJK_NGRAMS) break;
    }
    if (cjkNgrams >= MAX_CJK_NGRAMS) break;
  }

  const tokens = [...latinTokens, ...hangulTokens, ...cjkTokens].slice(0, MAX_TOKENS);
  if (tokens.length === 0) {
    return { indices: [], values: [] };
  }
  // term frequency
  const tf = new Map();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  // 해시: djb2 (문자열 -> uint32, worker/cloud 동일)
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = (h * 33 + s.charCodeAt(i)) >>> 0;
    }
    return h >>> 0;
  }
  const byIndex = new Map();
  for (const [term, count] of tf) {
    const idx = hashStr(term);
    const weight = 1 + Math.log(count);
    const prev = byIndex.get(idx) || 0;
    byIndex.set(idx, prev + weight);
  }
  const indices = [];
  const values = [];
  for (const [idx, val] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    indices.push(idx);
    values.push(val);
  }
  return { indices, values };
}

function normalizeEmbeddingLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

function extractValueFocusedSegment(segment) {
  const normalized = normalizeEmbeddingLine(segment);
  if (!normalized) return null;
  const match = normalized.match(/^(.{1,40}?)(?:\s*[:=]\s*|\t+)(.+)$/u);
  if (!match) return null;
  const keyPart = normalizeEmbeddingLine(match[1]);
  const valuePart = normalizeEmbeddingLine(match[2]);
  if (!keyPart || !valuePart) return null;
  if (keyPart.length >= valuePart.length) return null;
  return valuePart;
}

function buildValueFocusedEmbeddingText(text) {
  const normalizedLines = String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeEmbeddingLine(line))
    .filter((line) => line.length > 0);
  if (normalizedLines.length === 0) return "";

  const extractedValueLines = normalizedLines
    .map((line) => extractValueFocusedSegment(line))
    .filter(Boolean);

  // row.text가 "key: value" 반복 구조일 때만 value 중심 표현으로 바꿔
  // dense embedding에서 반복 라벨/헤더 노이즈를 줄인다.
  const shouldPreferValueFocusedText =
    extractedValueLines.length >= 2 &&
    extractedValueLines.length / normalizedLines.length >= 0.6;

  return shouldPreferValueFocusedText
    ? extractedValueLines.join("\n")
    : normalizedLines.join("\n");
}

function buildEmbeddingDataFromRowText(text) {
  if (!text || typeof text !== "string") {
    return { embeddingText: "" };
  }
  const embeddingText = buildValueFocusedEmbeddingText(text);

  return { embeddingText };
}

/**
 * 타임스탬프 정규화 함수
 * Firestore Timestamp 객체 또는 숫자(밀리초)를 일관된 숫자로 변환합니다.
 *
 * @param {number|Object|Date|null} ts - 타임스탬프 (숫자, Timestamp 객체, Date 객체)
 * @returns {number|null} - 밀리초 숫자 또는 null
 *
 * 예시:
 * normalizeTimestamp(1768733676000) → 1768733676000
 * normalizeTimestamp({ toMillis: () => 1768733676000 }) → 1768733676000
 * normalizeTimestamp({ _seconds: 1768733676 }) → 1768733676000
 */
function normalizeTimestamp(ts) {
  if (ts === null || ts === undefined) return null;
  if (typeof ts === "number") return ts;
  if (ts.toMillis) return ts.toMillis(); // Firestore Timestamp
  if (ts._seconds) return ts._seconds * 1000; // Firestore Timestamp (raw)
  if (ts instanceof Date) return ts.getTime();
  return null;
}

/**
 * 비동기 대기 함수
 * 지정된 시간(밀리초)만큼 대기합니다.
 *
 * @param {number} ms - 대기 시간 (밀리초)
 * @returns {Promise<void>} - 대기 완료 후 resolve
 *
 * 예시:
 * await sleep(1000);  // 1초 대기
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 지수 백오프 재시도 (네트워크/일시적 장애/timeout)
 * @param {(attempt:number)=>Promise<any>} fn
 * @param {object} options
 */
async function retryWithBackoff(fn, options = {}) {
  const maxRetries = Number(options.maxRetries ?? 3);
  const initialDelayMs = Number(options.initialDelayMs ?? 800);
  const maxDelayMs = Number(options.maxDelayMs ?? 10000);
  const backoffMultiplier = Number(options.backoffMultiplier ?? 2);
  const label = options.label || "retryWithBackoff";
  const tenantId = options.tenantId || null;

  let delay = initialDelayMs;
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (e) {
      const retryable = isRetryableError(e);
      if (!retryable || attempt >= maxRetries) {
        throw e;
      }
      attempt += 1;
      console.warn("transient_retry", {
        label,
        tenant: tenantId || "empty",
        attempt,
        maxRetries,
        delay_ms: delay,
        message: e?.message || String(e)
      });
      await sleep(delay);
      delay = Math.min(maxDelayMs, delay * backoffMultiplier);
    }
  }
}

/**
 * 안전한 JSON 파싱
 * JSON 문자열을 파싱하되, 에러가 발생하면 null을 반환합니다.
 *
 * @param {string} line - JSON 문자열
 * @returns {object|null} - 파싱된 객체 또는 null
 *
 * 예시:
 * safeJsonParse('{"key": "value"}')
 * → { key: "value" }
 *
 * safeJsonParse('invalid json')
 * → null
 */
function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function addVectorsInPlace(target, vec) {
  for (let i = 0; i < target.length; i++) target[i] += vec[i] || 0;
}

function subVectorsInPlace(target, vec) {
  for (let i = 0; i < target.length; i++) target[i] -= vec[i] || 0;
}

function scaleVector(vec, scalar) {
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = (vec[i] || 0) * scalar;
  return out;
}

const EMBED_VALUE_BASIS = "qdrant_cosine_v1";

// 같은 float32 단위 벡터를 저장과 평균에 사용해 증분에서 raw/stored 기준이 섞이지 않게 한다.
function toStoredCosineVector(vector) {
  const stored = vector.map(value => Math.fround(value));
  const squaredNorm = stored.reduce((sum, value) => sum + value * value, 0);
  if (!Number.isFinite(squaredNorm)) throw new Error("Invalid embedding vector values");
  // Qdrant도 이 크기 미만은 영벡터로 취급해 정규화하지 않는다.
  if (squaredNorm < 1.1920928955078125e-7) return stored;
  const inverseNorm = 1 / Math.sqrt(squaredNorm);
  return stored.map(value => Math.fround(value * inverseNorm));
}

function normalizeEmbeddingVector(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  // Qdrant named vectors: { embedding: [...] }
  if (Array.isArray(v.embedding)) return v.embedding;
  if (Array.isArray(v?.vector?.embedding)) return v.vector.embedding;
  if (Array.isArray(v?.vectors?.embedding)) return v.vectors.embedding;
  return null;
}

function safePreviewArrayLengths(v) {
  if (!v) return null;
  if (Array.isArray(v)) return { kind: "array", length: v.length };
  const emb = normalizeEmbeddingVector(v);
  if (Array.isArray(emb)) return { kind: "named", length: emb.length };
  return { kind: typeof v, length: null };
}

function meanVector(vectors, dim) {
  if (!vectors || vectors.length === 0) return null;
  const d = dim || vectors[0]?.length || 0;
  if (!d) return null;
  const sum = new Array(d).fill(0);
  for (const v of vectors) addVectorsInPlace(sum, v);
  for (let i = 0; i < d; i++) sum[i] /= vectors.length;
  return sum;
}

function sampleArray(arr, k) {
  const n = arr.length;
  if (k >= n) return [...arr];
  // Fisher-Yates partial shuffle
  const copy = [...arr];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, k);
}

// 재시도에서는 Qdrant가 부분 반영됐을 수 있어, 반영 완료 후 현재 벡터로 평균을 복원한다.
async function readDatasetMeanEmbedding(qdrant, collection, { tenant, dataset, vectorSize }) {
  const sum = new Array(vectorSize).fill(0);
  let count = 0;
  let offset = null;
  const seenOffsets = new Set();
  do {
    const response = await qdrant.qdrantFetch(`/collections/${collection}/points/scroll`, {
      method: "POST",
      body: {
        filter: { must: [
          { key: "tenant", match: { value: tenant } },
          { key: "dataset", match: { value: dataset } }
        ] },
        limit: 256,
        with_payload: false,
        with_vector: true,
        offset
      }
    });
    const page = response?.result;
    if (!Array.isArray(page?.points)) throw new Error("Invalid Qdrant mean recovery response");
    for (const point of page.points) {
      const vector = normalizeEmbeddingVector(point?.vector || point?.vectors);
      if (!vector || vector.length !== vectorSize || !vector.every(Number.isFinite)) {
        throw new Error("Invalid embedding vector during mean recovery");
      }
      addVectorsInPlace(sum, vector);
      count += 1;
    }
    offset = page.next_page_offset ?? null;
    if (offset !== null) {
      const key = JSON.stringify(offset);
      if (seenOffsets.has(key)) throw new Error("Repeated Qdrant mean recovery offset");
      seenOffsets.add(key);
    }
  } while (offset !== null);
  return {
    embedValue: count > 0 ? sum.map(value => value / count) : null,
    embedValueCount: count
  };
}

// ============================================================================
// Qdrant 클라이언트 (해결된 URL 사용)
// ============================================================================

/**
 * Qdrant 클라이언트 생성
 * Qdrant API와 통신하기 위한 함수들을 반환합니다.
 *
 * @param {string} qdrantUrl - Qdrant 서버 URL (예: "http://localhost:6333")
 * @param {string} tenantId - 테넌트 ID (에러 로깅용)
 * @returns {object} - Qdrant API 함수들
 */
function makeQdrantClient(qdrantUrl, tenantId = null, invocationSignal = null) {
  /**
   * Qdrant API 요청 (내부 함수)
   * Qdrant REST API에 HTTP 요청을 보냅니다.
   *
   * @param {string} path - API 경로 (예: "/collections/my_collection")
   * @param {object} options - 요청 옵션
   * @param {string} options.method - HTTP 메서드 (GET, POST, PUT 등)
   * @param {object} options.body - 요청 본문 (JSON 객체)
   * @returns {Promise<object|null>} - 응답 데이터 (JSON 파싱됨)
   * @throws {Error} - 요청 실패 시
   *
   * 예시:
   * await qdrantFetch("/collections/my_collection", { method: "GET" })
   * → { result: { ... } }
   */
  // tenantId는 makeQdrantClient의 클로저에서 사용 (별도 파라미터 불필요)
  async function qdrantFetch(path, { method = "GET", body } = {}) {
    const timeoutMs = Number(process.env.QDRANT_TIMEOUT_MS || "30000");
    const maxRetries = Number(process.env.QDRANT_MAX_RETRIES || "3");
    const initialDelayMs = Number(
      process.env.QDRANT_RETRY_INITIAL_DELAY_MS || "800"
    );
    const maxDelayMs = Number(process.env.QDRANT_RETRY_MAX_DELAY_MS || "10000");

    return await retryWithBackoff(
      async (attempt) => {
        const controller = new AbortController();
        const requestSignal = invocationSignal
          ? AbortSignal.any([controller.signal, invocationSignal])
          : controller.signal;
        const timeoutId = timeoutMs
          ? setTimeout(() => controller.abort(), timeoutMs)
          : null;
        let res;
        try {
          res = await fetch(`${qdrantUrl}${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
            signal: requestSignal
          });
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }

        const text = await res.text();
        if (!res.ok) {
          const error = new Error(
            `Qdrant ${method} ${path} failed: ${res.status} ${text}`
          );
          error.status = res.status;

          // GET /collections/{name} 404 = 컬렉션 없음(신규). ensureCollection에서 생성하므로 에러가 아님 → 로그만
          const isCollectionNotFound404 =
            res.status === 404 &&
            method === "GET" &&
            /^\/collections\/[^/]+$/.test(path);
          if (isCollectionNotFound404) {
            console.log("qdrant_collection_not_found", {
              tenant: tenantId || "empty",
              method,
              path,
              message: "Collection does not exist yet, will be created"
            });
          } else {
            // 실제 에러: 로그 + Sentry
            console.error("qdrant_api_error", {
              tenant: tenantId || "empty",
              method,
              path,
              status: res.status,
              response: text
            });
            // 재시도 중에는 Sentry 노이즈를 줄이기 위해 전송하지 않음 (최종 실패는 main() catch에서 전송됨)
            const retryable = isRetryableError(error);
            if (!retryable || attempt >= maxRetries) {
              captureErrorThrottled(
                error,
                {
                  tenant_id: tenantId || "empty",
                  function_name: "qdrantFetch",
                  extra: {
                    method,
                    path,
                    status: res.status,
                    response: text?.slice(0, 500),
                    operation: "qdrant_api",
                    retry_attempt: attempt,
                    max_retries: maxRetries
                  }
                },
                {
                  key: `qdrant_api_error:${tenantId || "empty"}:${method}:${path}:${res.status}`,
                  cooldownMs: 60_000,
                  sampleRate: 0.5
                }
              );
            }
          }
          throw error;
        }
        return text ? JSON.parse(text) : null;
      },
      {
        maxRetries,
        initialDelayMs,
        maxDelayMs,
        label: "qdrantFetch",
        tenantId
      }
    );
  }

  /**
   * 컬렉션 확인/생성 (하이브리드: embedding + bm25)
   * 컬렉션이 존재하지 않으면 named vectors(embedding=dense, bm25=sparse)로 생성하고,
   * 존재하면 dense 벡터 크기를 검증합니다.
   *
   * @param {string} collection - 컬렉션 이름
   * @param {number} vectorSize - dense 벡터 크기 (차원 수, 예: 1536)
   * @returns {Promise<void>}
   */
  async function ensureCollection(collection, vectorSize) {
    const VECTOR_EMBEDDING = "embedding";
    const VECTOR_BM25 = "bm25";

    try {
      const info = await qdrantFetch(`/collections/${collection}`);
      const params = info?.result?.config?.params || {};
      const vectors = params.vectors || {};
      const sparseVectors = params.sparse_vectors || {};

      // named vectors: embedding(dense) 크기 검증
      const existingSize =
        vectors[VECTOR_EMBEDDING]?.size ?? vectors.size ?? vectors.default?.size;
      if (existingSize && Number(existingSize) !== Number(vectorSize)) {
        throw new Error(
          `Vector size mismatch for collection ${collection}: existing=${existingSize}, new=${vectorSize}. ` +
            `You must migrate to a new collection or keep embed model consistent.`
        );
      }
      if (!sparseVectors[VECTOR_BM25]) {
        throw new Error(
          `Collection ${collection} missing sparse vector "${VECTOR_BM25}". Recreate collection with hybrid schema.`
        );
      }
      return;
    } catch (e) {
      const msg = e?.message ?? String(e);
      // 스키마/차원 불일치는 생성으로 덮으면 안 됨 → 즉시 실패
      if (msg.includes("Vector size mismatch") || msg.includes("missing sparse")) throw e;

      // 컬렉션 없음(404)인 경우에만 생성
      // - 네트워크/권한/기타 오류는 생성으로 넘어가면 원인 파악이 어려워지고, 더 큰 오류를 유발할 수 있음
      const status = e?.status;
      if (status !== 404) throw e;
    }

    // 하이브리드 스키마: embedding(dense) + bm25(sparse)
    await qdrantFetch(`/collections/${collection}`, {
      method: "PUT",
      body: {
        vectors: {
          [VECTOR_EMBEDDING]: {
            size: vectorSize,
            distance: "Cosine"
          }
        },
        sparse_vectors: {
          [VECTOR_BM25]: {}
        }
      }
    });
  }

  /**
   * 포인트 삽입/업데이트 (배치) — 하이브리드: vectors.embedding + vectors.bm25
   *
   * @param {string} collection - 컬렉션 이름
   * @param {Array<object>} points - 포인트 배열
   * @param {string|number} points[].id - 포인트 ID (UUID 또는 uint)
   * @param {object} points[].vector - named vectors: { embedding: number[], bm25: { indices, values } }
   * @param {object} points[].payload - 메타데이터
   * @returns {Promise<void>}
   */
  async function upsertPoints(collection, points) {
    await qdrantFetch(`/collections/${collection}/points?wait=true`, {
      method: "PUT",
      body: { points }
    });
  }

  /**
   * row_id 배열로 벡터 DB에서 삭제
   * @param {string} collection - 컬렉션 이름
   * @param {object} options - 삭제 옵션
   * @param {string} options.tenant - 테넌트 ID
   * @param {string} options.dataset - 데이터셋 ID
   * @param {Array<string>} options.rowIds - 삭제할 row_id 배열
   * @returns {Promise<void>}
   */
  async function deleteByRowIds(
    collection,
    { tenant, dataset: datasetId, rowIds }
  ) {
    if (rowIds.length === 0) return;

    // 1000개씩 배치로 삭제. Qdrant delete API는 PointsSelector로 filter만 허용하며,
    // filter에서 minimum_should 미지원 → row_id는 match.any로 지정.
    const DELETE_BATCH = 1000;
    for (let i = 0; i < rowIds.length; i += DELETE_BATCH) {
      const batch = rowIds.slice(i, i + DELETE_BATCH);

      const filter = {
        must: [
          { key: "tenant", match: { value: tenant } },
          { key: "dataset", match: { value: datasetId } },
          { key: "row_id", match: { any: batch } }
        ]
      };

      await qdrantFetch(`/collections/${collection}/points/delete?wait=true`, {
        method: "POST",
        body: { filter }
      });
    }
  }

  /**
   * Qdrant에서 기존 row_id 조회 (scroll API 사용)
   * pagination을 통해 모든 데이터를 가져옴 (limit: 10000)
   * @param {string} collection - 컬렉션 이름
   * @param {object} options - 조회 옵션
   * @param {string} options.tenant - 테넌트 ID
   * @param {string} options.dataset - 데이터셋 ID
   * @returns {Promise<Set<string>>} - row_id 집합
   */
  async function getExistingRowIdsFromQdrant(
    collection,
    { tenant, dataset: datasetId }
  ) {
    const rowIds = new Set();
    let offset = null;

    // limit: 10000 (Qdrant scroll API 권장 최대값)
    // 10000개 이상이면 자동으로 pagination 처리 (offset 사용)
    const SCROLL_LIMIT = 10000;

    do {
      const result = await qdrantFetch(
        `/collections/${collection}/points/scroll`,
        {
          method: "POST",
          body: {
            filter: {
              must: [
                { key: "tenant", match: { value: tenant } },
                { key: "dataset", match: { value: datasetId } }
              ]
            },
            limit: SCROLL_LIMIT,
            with_payload: ["row_id"], // row_id 필드만 가져오기 (메모리 최적화)
            with_vector: false,
            offset
          }
        }
      );

      // result.result.points가 배열인지 확인 (빈 배열도 정상 응답)
      if (Array.isArray(result?.result?.points)) {
        for (const p of result.result.points) {
          const id = p?.payload?.row_id;
          if (id) rowIds.add(id);
        }
        offset = result.result.next_page_offset;

        // next_page_offset이 null이면 더 이상 데이터가 없음
        if (!offset) {
          break;
        }
      } else {
        // 응답 구조가 예상과 다르면 중단
        break;
      }
    } while (offset);

    return rowIds;
  }

  async function retrievePoints(collection, ids) {
    if (!ids || ids.length === 0) return [];
    const result = await qdrantFetch(`/collections/${collection}/points`, {
      method: "POST",
      body: {
        ids,
        with_payload: ["row_id", "tenant", "dataset"],
        with_vector: true
      }
    });
    return Array.isArray(result?.result) ? result.result : [];
  }

  /**
   * row_id 목록에 해당하는 "기존 embedding 벡터"를 가져옵니다.
   * - 증분 업로드 시 embed_value(평균 벡터) 정합 업데이트를 위해 사용
   * @returns {Promise<Map<string, number[]>>} row_id -> embedding vector
   */
  async function getEmbeddingVectorsByRowIds(
    collection,
    { tenant, dataset: datasetId, rowIds }
  ) {
    const map = new Map();
    if (!rowIds || rowIds.length === 0) return map;
    const BATCH = 256;
    const want = new Set(rowIds.map((r) => String(r)));

    // 1) 가능하면 retrieve(ids)로 가져오기 (더 빠름)
    try {
      for (let i = 0; i < rowIds.length; i += BATCH) {
        const batch = rowIds.slice(i, i + BATCH);
        const ids = batch.map((rid) => hexToUuid(rid));
        const points = await retrievePoints(collection, ids);
        for (const p of points) {
          const payload = p?.payload || {};
          const rid = payload.row_id;
          if (!rid || !want.has(String(rid))) continue;
          if (payload.tenant !== tenant || payload.dataset !== datasetId) continue;
          const named = p?.vector || p?.vectors;
          const finalVec = normalizeEmbeddingVector(named);
          if (finalVec && Array.isArray(finalVec) && finalVec.length > 0) {
            map.set(String(rid), finalVec);
          }
        }
      }
      return map;
    } catch (e) {
      console.warn("qdrant_retrieve_fallback_to_scroll", {
        tenant: tenantId || "empty",
        message: e?.message || String(e)
      });
    }

    // 2) retrieve가 안 되면 scroll(filter)로 폴백
    for (let i = 0; i < rowIds.length; i += BATCH) {
      const batch = rowIds.slice(i, i + BATCH);
      const result = await qdrantFetch(`/collections/${collection}/points/scroll`, {
        method: "POST",
        body: {
          filter: {
            must: [
              { key: "tenant", match: { value: tenant } },
              { key: "dataset", match: { value: datasetId } },
              { key: "row_id", match: { any: batch } }
            ]
          },
          limit: batch.length,
          with_payload: ["row_id"],
          with_vector: true
        }
      });

      const points = Array.isArray(result?.result?.points) ? result.result.points : [];
      for (const p of points) {
        const rid = p?.payload?.row_id;
        const named = p?.vector || p?.vectors;
        const finalVec = normalizeEmbeddingVector(named);
        if (rid && finalVec && Array.isArray(finalVec) && finalVec.length > 0) {
          map.set(String(rid), finalVec);
        }
      }
    }
    return map;
  }

  return {
    qdrantFetch,
    ensureCollection,
    upsertPoints,
    deleteByRowIds,
    getExistingRowIdsFromQdrant,
    getEmbeddingVectorsByRowIds
  };
}

// ============================================================================
// OpenAI 임베딩 함수들
// ============================================================================

/**
 * 재시도 로직이 포함된 임베딩 생성
 * OpenAI API 호출 실패 시 지수 백오프(exponential backoff)로 재시도합니다.
 *
 * 재시도 전략:
 * - 최대 재시도 횟수: maxRetries (기본값: 5)
 * - 대기 시간: 800ms * 2^(attempt-1) + 랜덤 지터(0~300ms)
 * - 최대 대기 시간: 15초
 *
 * @param {OpenAI} openai - OpenAI 클라이언트 인스턴스
 * @param {object} options - 옵션
 * @param {string} options.model - 임베딩 모델 (예: "text-embedding-3-small")
 * @param {Array<string>} options.inputs - 임베딩할 텍스트 배열
 * @param {number} options.maxRetries - 최대 재시도 횟수 (기본값: 5)
 * @param {string} [options.tenantId] - 테넌트 ID (로깅용, 선택)
 * @returns {Promise<object>} - OpenAI API 응답
 * @throws {Error} - 최대 재시도 횟수 초과 시
 *
 * 예시:
 * await embedWithRetry(openai, {
 *   model: "text-embedding-3-small",
 *   inputs: ["안녕하세요", "반갑습니다"],
 *   maxRetries: 5
 * })
 * → { data: [{ embedding: [0.1, 0.2, ...] }, ...] }
 *
 * 재시도 대기 시간 예시:
 * - attempt 1: 800ms + 0~300ms = 800~1100ms
 * - attempt 2: 1600ms + 0~300ms = 1600~1900ms
 * - attempt 3: 3200ms + 0~300ms = 3200~3500ms
 * - attempt 4: 6400ms + 0~300ms = 6400~6700ms
 * - attempt 5: 12800ms + 0~300ms = 12800~13100ms (최대 15초로 제한)
 */
async function embedWithRetry(
  openai,
  {
    model,
    inputs,
    maxRetries = 5,
    tenantId = null,
    expectedDim = null,
    signal = null
  }
) {
  let attempt = 0;
  const embedTimeoutMs = Number(process.env.EMBED_REQUEST_TIMEOUT_MS || "30000");
  while (true) {
    try {
      const requestController = new AbortController();
      const requestSignal = signal
        ? AbortSignal.any([requestController.signal, signal])
        : requestController.signal;
      const timeoutId = embedTimeoutMs
        ? setTimeout(
          () => requestController.abort(
            new Error(`OpenAI embedding request timed out (timeout: ${embedTimeoutMs}ms)`)
          ),
          embedTimeoutMs
        )
        : null;
      try {
        return await openai.embeddings.create({
          model,
          input: inputs,
          // 일부 OpenAI-호환 엔드포인트/프록시에서 기본 차원을 축소(예: 384)하는 케이스가 관측됨.
          // text-embedding-3-*는 dimensions 파라미터를 지원하므로, 기대 차원을 명시해 혼입을 차단.
          ...(expectedDim ? { dimensions: expectedDim } : {}),
          encoding_format: "float"
        }, { signal: requestSignal });
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (e) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("Ingest invocation aborted");
      }
      // 4xx/설정성 오류는 재시도해도 해결되지 않는 경우가 많아 즉시 실패 처리
      const status = Number(e?.status || e?.statusCode || 0);
      const msg = (e?.message || String(e)).toLowerCase();
      if (
        status === 400 ||
        status === 401 ||
        status === 403 ||
        msg.includes("invalid embedding vector dimension") ||
        msg.includes("embedding batch size mismatch")
      ) {
        throw e;
      }
      attempt += 1;
      if (attempt > maxRetries) {
        // 최대 재시도 횟수 초과 시 Sentry로 에러 전송
        console.error("embed_max_retries_exceeded", {
          tenant: tenantId || "empty",
          attempt,
          maxRetries,
          message: e?.message ?? String(e),
          stack: e?.stack
        });
        captureError(e, {
          tenant_id: tenantId || "empty",
          function_name: "embedWithRetry",
          extra: {
            attempt,
            maxRetries,
            operation: "embedding",
            message: "Embedding failed after max retries"
          }
        });
        throw e; // 최대 재시도 횟수 초과 시 에러 발생
      }

      // 지수 백오프 계산
      const base = 800 * Math.pow(2, attempt - 1); // 800, 1600, 3200, ...
      const jitter = Math.floor(Math.random() * 300); // 0~300ms 랜덤 지터
      const wait = Math.min(15000, base + jitter); // 최대 15초로 제한

      console.warn("embed_retry", {
        tenant: tenantId || "empty",
        attempt,
        wait_ms: wait,
        message: e?.message ?? String(e)
      });
      await sleep(wait); // 대기 후 재시도
    }
  }
}

/**
 * 배치 단위 임베딩 생성
 * 대량의 텍스트를 배치로 나누어 임베딩을 생성합니다.
 * OpenAI API는 한 번에 최대 2048개까지 처리할 수 있지만,
 * 안정성을 위해 기본적으로 64개씩 배치로 나눕니다.
 *
 * 예시:
 * await embedInBatches(openai, {
 *   model: "text-embedding-3-small",
 *   texts: ["텍스트1", "텍스트2", ..., "텍스트200"],
 *   batchSize: 64,
 *   maxRetries: 5
 * })
 * → [
 *     [0.1, 0.2, ...],  // 텍스트1의 임베딩 (1536차원)
 *     [0.3, 0.4, ...],  // 텍스트2의 임베딩
 *     ...
 *   ]
 *
 * 처리 흐름:
 * - 200개 텍스트, batchSize=64 → 4개 배치 (64, 64, 64, 8)
 * - 각 배치를 순차적으로 처리
 * - 모든 벡터를 하나의 배열로 병합하여 반환
 */
async function embedInBatches(
  openai,
  {
    model,
    texts,
    batchSize = 64,
    maxRetries = 5,
    expectedDim = null,
    signal = null
  },
  tenantId = null // 로깅용 (선택)
) {
  const vectors = new Array(texts.length);
  let totalTokens = 0; // 총 토큰 사용량 추적 (완료 후 합산)
  const concurrency = Math.max(
    1,
    Number(process.env.EMBED_CONCURRENCY || "1")
  );

  // 배치 작업 목록 생성
  const batches = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push({ start: i, batch: texts.slice(i, i + batchSize) });
  }
  const tokensByBatch = new Array(batches.length).fill(0);

  let idx = 0;
  async function workerLoop() {
    while (idx < batches.length) {
      const cur = idx++;
      const { start, batch } = batches[cur];

      const emb = await embedWithRetry(openai, {
        model,
        inputs: batch,
        maxRetries,
        tenantId,
        expectedDim,
        signal
      });

      const gotCount = Array.isArray(emb?.data) ? emb.data.length : 0;
      const wantCount = batch.length;
      const firstLen = Array.isArray(emb?.data?.[0]?.embedding)
        ? emb.data[0].embedding.length
        : null;
      const responseModel = typeof emb?.model === "string" ? emb.model : null;

      // 방어: 응답 개수/차원 불일치는 즉시 실패 (후속 단계에서 섞임/누락으로 폭발)
      if (gotCount !== wantCount) {
        const err = new Error(
          `Embedding batch size mismatch: expected_count=${wantCount}, got_count=${gotCount}`
        );
        err.status = 400;
        console.error("embedding_batch_size_mismatch", {
          tenant: tenantId || "empty",
          model,
          response_model: responseModel,
          from: start,
          to: Math.min(texts.length, start + batch.length),
          expected_count: wantCount,
          got_count: gotCount,
          first_embedding_len: firstLen
        });
        throw err;
      }
      if (expectedDim && firstLen && firstLen !== expectedDim) {
        const err = new Error(
          `Invalid embedding vector dimension from provider: expected=${expectedDim}, got=${firstLen}`
        );
        err.status = 400;
        console.error("embedding_dim_mismatch_from_provider", {
          tenant: tenantId || "empty",
          model,
          response_model: responseModel,
          from: start,
          to: Math.min(texts.length, start + batch.length),
          expected_dim: expectedDim,
          got_dim: firstLen
        });
        throw err;
      }

      // 토큰 사용량 추적 (usage 필드가 있으면 사용, 없으면 텍스트 길이 기반 추정)
      let tokensThisBatch = 0;
      if (emb.usage?.total_tokens) {
        tokensThisBatch = emb.usage.total_tokens;
      } else {
        const estimatedTokens = batch.reduce((sum, text) => {
          return sum + Math.ceil((text?.length || 0) / 4);
        }, 0);
        tokensThisBatch = estimatedTokens;
      }
      tokensByBatch[cur] = tokensThisBatch;

      // 순서 보장: start 인덱스부터 채움
      for (let j = 0; j < emb.data.length; j++) {
        const vec = emb.data[j]?.embedding;
        const len = Array.isArray(vec) ? vec.length : null;
        if (expectedDim && len !== expectedDim) {
          const err = new Error(
            `Invalid embedding vector dimension: expected=${expectedDim}, got=${len || "null"}`
          );
          err.status = 400;
          console.error("embedding_vector_dim_invalid", {
            tenant: tenantId || "empty",
            model,
            batch_from: start,
            batch_to: Math.min(texts.length, start + batch.length),
            idx: start + j,
            expected_dim: expectedDim,
            got_dim: len
          });
          throw err;
        }
        vectors[start + j] = vec;
      }

      console.log("embedded_batch", {
        tenant: tenantId || "empty",
        from: start,
        to: Math.min(texts.length, start + batch.length),
        tokens_this_batch: emb.usage?.total_tokens || null
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
  totalTokens = tokensByBatch.reduce((a, b) => a + (b || 0), 0);

  return { vectors, totalTokens };
}

// ============================================================================
// 메인 함수
// ============================================================================

/**
 * 메인 처리 함수
 * GCS에서 JSONL 파일을 다운로드하고, 텍스트를 임베딩 벡터로 변환한 후
 * Qdrant에 저장하는 전체 워크플로우를 실행합니다.
 *
 * 처리 단계:
 * 1. 환경변수에서 설정 읽기
 * 2. GCS에서 JSONL 파일 다운로드
 * 3. JSONL 파싱 (row_id, text, version 추출)
 * 4. 텍스트를 임베딩 벡터로 변환 (배치 처리)
 * 5. Qdrant 컬렉션 확인/생성
 * 6. 기존 row_id 조회 후 추가/업데이트/삭제 분류 (incremental)
 * 7. 삭제된 row 삭제 + 새/변경 row upsert
 *
 * 필수 환경변수:
 * - TENANT: 테넌트 ID
 * - DATASET: 데이터셋 ID
 * - GCS_PATH: GCS 파일 경로 (실제 작업용: toAdd만, 새로 추가된 row만)
 * - OPENAI_API_KEY: OpenAI API 키
 * - QDRANT_URL: Qdrant 서버 URL
 *
 * 선택 환경변수 (기본값 있음):
 * - EMBED_MODEL: 임베딩 모델 (기본값: "text-embedding-3-small")
 * - VECTOR_SIZE: 벡터 차원 (기본값: 1536, text-embedding-3-small)
 *
 * 선택 환경변수:
 * - FULL_GCS_PATH: 전체 GCS 파일 경로 (삭제 파악용: 전체 newRows, 있으면 사용)
 *   → 없으면 GCS_PATH를 삭제 파악용으로도 사용 (하위 호환성)
 *
 * 선택 환경변수:
 * - JOB_ID: 작업 ID (기본값: "local")
 * - QDRANT_COLLECTION_BASE: 컬렉션 기본 이름 (기본값: "cm_chunks")
 * - EMBED_BATCH: 배치 크기 (기본값: 64)
 * - EMBED_MAX_RETRIES: 최대 재시도 횟수 (기본값: 5)
 *
 * 참고: MAX_ROWS, MAX_TEXT_CHARS는 uploadDataset.js에서 이미 체크했으므로
 * worker.js에서는 체크하지 않음
 */
// ============================================================================
// Timeout 감지 및 정리 함수
// ============================================================================

/**
 * Dataset 상태를 FAILED로 업데이트하고 정리 작업 수행
 * @param {string} tenant - 테넌트 ID
 * @param {string} datasetId - 데이터셋 ID
 * @param {string} reason - 실패 이유
 */
async function updateStatusToFailedAndCleanup(
  tenant,
  datasetId,
  reason,
  datasetLocale,
  jobId
) {
  if (getApps().length === 0) {
    initializeApp();
  }
  const db = getFirestore();

  const datasetRef = db
    .collection("tenants")
    .doc(tenant)
    .collection("datasets")
    .doc(datasetId);

  const locale = normalizeWorkerLocale(datasetLocale);
  const errorForUser = getWorkerLocalizedDatasetError(
    reason != null ? String(reason) : "",
    locale
  );

  let statusUpdated = false;
  await db.runTransaction(async (transaction) => {
    statusUpdated = false;
    const snapshot = await transaction.get(datasetRef);
    if (
      jobId &&
      snapshot.exists &&
      snapshot.data()?.processing_job_id !== jobId
    ) {
      return;
    }
    transaction.set(
      datasetRef,
      {
        status: DatasetStatus.FAILED,
        processing_job_id: FieldValue.delete(),
        updated_at: Date.now(),
        error: errorForUser
      },
      { merge: true }
    );
    statusUpdated = true;
  });

  console.log("dataset_status_updated_to_failed", {
    tenant,
    dataset_id: datasetId,
    reason,
    error_localized: errorForUser,
    dataset_locale: locale,
    job_id: jobId || null,
    status_updated: statusUpdated,
    message: statusUpdated
      ? "Dataset status updated to failed"
      : "Dataset failure update safely skipped because job ownership changed"
  });
  return { handled: true, statusUpdated };
}

class IngestExecutionError extends Error {
  constructor(message, { cause, retryable = false, statusHandled = false, code = "INGEST_FAILED" } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "IngestExecutionError";
    this.retryable = retryable;
    this.statusHandled = statusHandled;
    this.code = code;
  }
}

function createInvocationLifecycle({ tenant, datasetId, datasetLocale, jobId }) {
  const startedAt = Date.now();
  const WARNING_TIME_MS = 18 * 60 * 1000;
  const TERMINATION_TIME_MS = 18.5 * 60 * 1000;
  let terminating = false;
  let terminationError = null;
  let warningTimer = null;
  let timeoutTimer = null;
  const abortController = new AbortController();

  warningTimer = setTimeout(() => {
    if (terminating) return;
    const elapsed = Date.now() - startedAt;
    console.warn("timeout_warning", {
      tenant,
      dataset_id: datasetId,
      elapsed_ms: elapsed,
      elapsed_minutes: Math.round(elapsed / 60000),
      remaining_seconds: Math.round((TERMINATION_TIME_MS - elapsed) / 1000),
      message: "Timeout warning: Termination will occur in 30 seconds"
    });
  }, WARNING_TIME_MS);

  timeoutTimer = setTimeout(() => {
    if (terminating) return;
    terminating = true;
    const elapsed = Date.now() - startedAt;
    const reason = `Job timeout: Execution exceeded ${Math.round(elapsed / 60000)} minutes. The job is being terminated to prevent Cloud Functions timeout.`;
    console.warn("timeout_termination", {
      tenant,
      dataset_id: datasetId,
      elapsed_ms: elapsed,
      elapsed_minutes: Math.round(elapsed / 60000),
      message: "Timeout reached, aborting in-flight work before responding"
    });
    terminationError = new IngestExecutionError(reason, {
      retryable: false,
      statusHandled: false,
      code: "INGEST_TIMEOUT"
    });
    abortController.abort(terminationError);
    captureError(terminationError, {
      tenant_id: tenant || "empty",
      function_name: "runIngest.timeout",
      extra: { dataset_id: datasetId, elapsed_ms: elapsed }
    });
  }, TERMINATION_TIME_MS);

  return {
    signal: abortController.signal,
    isTerminating: () => terminating,
    getTerminationError: () => terminationError,
    assertActive() {
      if (terminating) {
        throw terminationError;
      }
    },
    cleanup() {
      if (warningTimer) clearTimeout(warningTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      warningTimer = null;
      timeoutTimer = null;
    }
  };
}

async function executeIngest(options, lifecycle) {
  // ========================================================================
  // 1. 환경변수 읽기 및 검증
  // ========================================================================

  const jobId = String(options?.jobId ?? "local").trim() || "local";
  const tenant = String(options?.tenant ?? "").trim();
  const datasetId = String(options?.datasetId ?? "default").trim();
  const gsPath = String(options?.gcsPath ?? "").trim();
  const fullGsPath = String(options?.fullGcsPath ?? "").trim();
  const qdrantUrl = String(options?.qdrantUrl ?? "").trim();
  const embedModel = String(options?.embedModel ?? "text-embedding-3-small").trim();
  const vectorSize = options?.vectorSize != null ? Number(options.vectorSize) : 1536;
  const datasetLocale = normalizeWorkerLocale(options?.datasetLocale);

  // 필수 환경변수 검증
  if (!tenant) {
    const error = new Error("TENANT is required");
    console.error("missing_required_env", {
      tenant: tenant || "empty",
      dataset_id: datasetId,
      error: error.message,
      message: "TENANT option is missing or empty"
    });
    throw error;
  }
  if (!gsPath) {
    const error = new Error("GCS_PATH is required");
    console.error("missing_required_env", {
      tenant,
      dataset_id: datasetId,
      error: error.message,
      message: "GCS_PATH option is missing or empty"
    });
    throw error;
  }

  // ========================================================================
  // 1-1. Dataset 상태 체크 및 업데이트 (동시 실행 방지)
  // ========================================================================
  // ✅ 개선: 같은 dataset에 대한 다른 작업이 실행 중인지 확인
  // 작업 ID를 Firestore에 저장하여 같은 작업인지 다른 작업인지 구분
  let previousEmbedValue = null;
  let previousEmbedValueCount = null;
  let previousEmbedValueBasis = null;
  let rebuildEmbedValueFromQdrant = false;
  try {
    if (getApps().length === 0) {
      initializeApp();
    }
    const db = getFirestore();

    const datasetRef = db
      .collection("tenants")
      .doc(tenant)
      .collection("datasets")
      .doc(datasetId);

    // 현재 작업의 고유 ID (재시도에서도 동일해야 함)
    // - Cloud Run Job 재시도에서는 "같은 실행"으로 간주하고 이어서 진행할 수 있어야 함
    // - uploadDataset.js에서 주입하는 JOB_ID가 있으면 그것을 우선 사용
    // - 없으면 Cloud Run 기본 env를 최대한 사용 (없으면 local fallback)
    const currentJobId = jobId;

    // Dataset 상태를 INDEXING으로 업데이트 (트랜잭션으로 원자성 보장)
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(datasetRef);
      const docData = doc.exists ? doc.data() : {};
      const docStatus = docData?.status;
      const docProcessingJobId = docData?.processing_job_id;
      const docLastUpdated = docData?.updated_at;
      rebuildEmbedValueFromQdrant =
        docStatus === DatasetStatus.INDEXING && docProcessingJobId === currentJobId;
      previousEmbedValueBasis = docData?.embed_value_basis;
      previousEmbedValue = Array.isArray(docData?.embed_value)
        ? docData.embed_value
        : null;
      previousEmbedValueCount =
        typeof docData?.embed_value_count === "number"
          ? docData.embed_value_count
          : null;

      const isActiveStatus =
        docStatus === DatasetStatus.PROCESSING ||
        docStatus === DatasetStatus.INDEXING;

      // PROCESSING/INDEXING 상태이고 최근에 업데이트된 경우 (30분 이내)
      if (isActiveStatus && docLastUpdated) {
        // updated_at 타입 호환: Timestamp 객체 또는 숫자(밀리초)
        const lastUpdatedTime = normalizeTimestamp(docLastUpdated);
        const now = Date.now();
        const timeSinceUpdate = now - lastUpdatedTime;
        const MAX_INDEXING_TIME_MS = 30 * 60 * 1000; // 30분

        if (timeSinceUpdate < MAX_INDEXING_TIME_MS) {
          // 다른 작업이 실행 중인지 확인 (processing_job_id 비교)
          // - processing_job_id가 currentJobId와 같으면 "같은 실행의 재시도/재기동"으로 간주하고 진행
          if (docProcessingJobId && docProcessingJobId !== currentJobId) {
            // 다른 작업이 실행 중임
            throw new Error(
              `Another indexing job (${docProcessingJobId}) is already running for dataset ${datasetId}. ` +
              `Current job ID: ${currentJobId}. Please wait for it to complete or check the dataset status.`
            );
          } else if (!docProcessingJobId) {
            // processing_job_id가 없으면 이전 버전의 코드에서 실행된 것일 수 있음
            // 안전을 위해 실패 처리
            throw new Error(
              `Dataset ${datasetId} is in ${docStatus} status but processing_job_id is missing. ` +
              `This may indicate a stuck job. Please check the dataset status manually.`
            );
          }
          // docProcessingJobId === currentJobId인 경우는 같은 작업이 재시도하는 경우
          // 이 경우는 계속 진행 (상태 업데이트)
        } else {
          // 30분 이상 지났으면 이전 작업이 멈춰있을 가능성이 높음 (타임아웃 또는 실패)
          // 상태를 강제로 업데이트하고 계속 진행
          console.warn("dataset_indexing_timeout", {
            tenant,
            dataset_id: datasetId,
            previous_job_id: docProcessingJobId,
            current_job_id: currentJobId,
            time_since_update_ms: timeSinceUpdate,
            message:
              "Previous indexing job may have timed out, proceeding with new job"
          });
        }
      }

      // 상태 업데이트 (processing_job_id 포함)
      transaction.set(
        datasetRef,
        {
          status: DatasetStatus.INDEXING,
          processing_job_id: currentJobId, // 현재 작업 ID 저장
          updated_at: Date.now()
        },
        { merge: true }
      );
    });

    console.log("dataset_status_updated", {
      tenant,
      dataset_id: datasetId,
      job_id: currentJobId,
      status: DatasetStatus.INDEXING,
      message: "Dataset status updated to indexing"
    });

    // ========================================================================
    // Timeout 감지 및 시그널 핸들러 설정
    // ========================================================================
    // 18분 30초 경과 시 상태를 FAILED로 업데이트하고 즉시 강제 종료
    // Cloud Run이 강제 종료하기 전에 정리 작업 수행
  } catch (statusUpdateError) {
    // 상태 업데이트 실패 시 작업 중단 (동시 실행 방지)
    const errorMessage =
      statusUpdateError?.message || String(statusUpdateError);
    if (
      errorMessage.includes("already running") ||
      errorMessage.includes("stuck job")
    ) {
      // 다른 작업이 실행 중이면 작업 중단
      // ⚠️ 중요: 이 케이스는 "실패"가 아니라 "중복 실행 방지"이므로
      // dataset status를 FAILED로 만들면 안 됩니다. (동시에 돌고 있는 정상 작업이 있음)
      console.warn("dataset_concurrent_indexing_detected", {
        tenant,
        dataset_id: datasetId,
        error: errorMessage
      });
      // Sentry는 노이즈 방지를 위해 쿨다운 적용 (운영에서 따닥/중복 호출이 가끔 발생할 수 있음)
      captureErrorThrottled(
        statusUpdateError,
        {
          tenant_id: tenant || "empty",
          function_name: "main",
          extra: {
            dataset_id: datasetId,
            operation: "concurrent_indexing_check",
            message: "Concurrent indexing detected; worker aborted without changing status",
            severity: "warning"
          }
        },
        { key: `concurrent_indexing:${tenant}:${datasetId}`, cooldownMs: 60_000, sampleRate: 0.2 }
      );

      return {
        outcome: "skipped_concurrent",
        skipped: true,
        retryable: false,
        tenant,
        datasetId,
        jobId,
        reason: errorMessage
      };
    } else {
      // 다른 에러는 로그를 남기고 에러를 다시 throw하여 main().catch()에서 처리
      // 초기화 단계에서 실패하면 상태 업데이트가 불가능하므로 main().catch()에서 처리하도록 함
      console.error("dataset_status_update_failed", {
        tenant,
        dataset_id: datasetId,
        error: errorMessage,
        stack: statusUpdateError?.stack,
        message: "Dataset status update failed at initialization. Will be handled by main().catch()"
      });
      // Sentry로 에러 전송
      captureError(statusUpdateError, {
        tenant_id: tenant || "empty",
        function_name: "main",
        extra: {
          dataset_id: datasetId,
          operation: "dataset_status_update",
          message: "Dataset status update failed at job start"
        }
      });
      // 에러를 다시 throw하여 main().catch()에서 처리하도록 함
      // 이렇게 하면 상태 업데이트와 로깅이 main().catch()에서 일관되게 처리됨
      throw statusUpdateError;
    }
  }

  // 컬렉션 이름 생성
  // 형식: {base}__{tenant}
  // 예: base="cm_chunks", tenant="hadfamily" → "cm_chunks__hadfamily"
  const baseCollection = (
    process.env.QDRANT_COLLECTION_BASE ?? "cm_chunks"
  ).trim();
  const collection = `${baseCollection}__${toSafeCollectionName(tenant)}`;

  // 선택 환경변수 (기본값 사용)
  const embedBatch = Number(process.env.EMBED_BATCH ?? "64"); // 배치 크기
  const embedMaxRetries = Number(process.env.EMBED_MAX_RETRIES ?? "5"); // 최대 재시도 횟수

  // 참고: MAX_ROWS, MAX_TEXT_CHARS는 uploadDataset.js에서 이미 체크했으므로
  // worker.js에서는 환경변수로 받지 않고 체크하지 않음

  // 버전 관리는 row별로만 수행 (dataset별 versions 컬렉션 제거)

  // 필수 환경변수 검증
  if (!tenant) throw new Error("TENANT is required");
  if (!datasetId) throw new Error("DATASET is required");
  if (!gsPath) throw new Error("GCS_PATH is required (JSONL 권장)");
  if (!process.env.OPENAI_API_KEY)
    throw new Error("OPENAI_API_KEY is required");
  // embedModel은 기본값이 있으므로 체크 불필요

  // FULL_GCS_PATH가 있으면 삭제 파악용으로 사용, 없으면 GCS_PATH를 삭제 파악용으로 사용 (하위 호환성)
  const deleteDetectionGsPath = fullGsPath || gsPath;

  // QDRANT_URL is supplied per invocation.
  if (!qdrantUrl) {
    throw new Error("QDRANT_URL is required");
  }

  // Qdrant 클라이언트 생성 (tenantId 전달하여 에러 로깅에 포함)
  const qdrant = makeQdrantClient(qdrantUrl, tenant, lifecycle.signal);

  const jobStartedAt = Date.now();

  // 시작 로그
  let openaiBaseUrlSource = null;
  let openaiBaseUrlRaw = null;
  for (const [k, v] of [
    ["OPENAI_BASE_URL", process.env.OPENAI_BASE_URL],
    ["OPENAI_API_BASE", process.env.OPENAI_API_BASE],
    ["OPENAI_ENDPOINT", process.env.OPENAI_ENDPOINT],
    ["OPENAI_HOST", process.env.OPENAI_HOST]
  ]) {
    if (v && String(v).trim()) {
      openaiBaseUrlSource = k;
      openaiBaseUrlRaw = String(v);
      break;
    }
  }
  const openaiBaseUrl = sanitizeUrlForLog(openaiBaseUrlRaw);

  console.log("start", {
    node_version: process.version,
    jobId,
    tenant,
    dataset_id: datasetId,
    gs_path: gsPath, // 실제 작업용
    full_gcs_path: fullGsPath || null, // 삭제 파악용 (있으면 사용)
    collection,
    embedModel,
    vectorSize,
    embedBatch,
    embedMaxRetries,
    qdrantUrl,
    openai_base_url: openaiBaseUrl,
    openai_base_url_source: openaiBaseUrlSource
  });

  // ========================================================================
  // 2. GCS에서 JSONL 파일 다운로드
  // ========================================================================
  // 2-1. 실제 작업용 JSONL 다운로드 (GCS_PATH: toAdd만, 새로 추가된 row만)
  // 2-2. 삭제 파악용 JSONL 다운로드 (FULL_GCS_PATH: 전체 newRows, 있으면 사용)

  // GCS는 Functions 공용 firebase.js 클라이언트를 재사용한다.

  // ========================================================================
  // 3. JSONL 파싱
  // ========================================================================
  // 3-1. 실제 작업용 JSONL 파싱 (GCS_PATH: toAdd만, 새로 추가된 row만)
  // 3-2. 삭제 파악용 JSONL 파싱 (FULL_GCS_PATH: 전체 newRows, 있으면 사용)

  // 실제 작업용 JSONL 파싱 (스트리밍)
  const rows = await readJsonlRowsFromGcs(storage, gsPath, tenant, datasetId);
  lifecycle.assertActive();
  console.log("worker_rows_count", rows.length); // 실제 작업용 행 수

  // 삭제 파악용 JSONL 파싱 (있으면 사용)
  let allNewRowIds = new Set(rows.map((r) => r.rowId)); // 기본값: worker JSONL의 row_id
  let fullRowsCountForMetadata = null; // 전체 rows count (jsonl_paths 저장 시 사용)
  if (fullGsPath && fullGsPath !== gsPath) {
    const fullParsed = await readJsonlRowIdsAndCountFromGcs(
      storage,
      fullGsPath,
      tenant,
      datasetId
    );
    allNewRowIds = fullParsed.rowIds; // 전체 newRows의 row_id
    fullRowsCountForMetadata = fullParsed.rowsCount;
    console.log("full_rows_count", fullRowsCountForMetadata); // 전체 행 수
  }

  // ========================================================================
  // 3.5. Qdrant 컬렉션 확인/생성 (없으면 생성)
  // ========================================================================
  // 신규 tenant/dataset인 경우 컬렉션이 없으므로, scroll 전에 반드시 생성해 둠.
  // 없으면 생성하고, 있으면 벡터 크기만 검증.
  await qdrant.ensureCollection(collection, vectorSize);
  lifecycle.assertActive();

  // ========================================================================
  // 4. 기존 row_id 조회 및 비교/분류
  // ========================================================================
  // Qdrant에서 기존 row_id 조회 (row별 관리, docId 필터 제거)
  const existingRowIdsFromQdrant = await qdrant.getExistingRowIdsFromQdrant(
    collection,
    {
      tenant,
      dataset: datasetId
    }
  );

  lifecycle.assertActive();
  console.log("existing_row_ids_from_qdrant", existingRowIdsFromQdrant.size);

  // 이전 버전의 혼합 기준 평균은 다음 성공 작업에서 한 번만 읽어 보정한다.
  if (existingRowIdsFromQdrant.size > 0 && previousEmbedValueBasis !== EMBED_VALUE_BASIS) {
    rebuildEmbedValueFromQdrant = true;
  }

  if (
    rows.length === 0 &&
    allNewRowIds.size === 0 &&
    existingRowIdsFromQdrant.size === 0 &&
    !rebuildEmbedValueFromQdrant
  ) {
    throw new Error(
      "No valid rows found in worker JSONL and no existing dataset rows to delete."
    );
  }

  // 실제 작업용: GCS_PATH의 모든 row를 toAdd에 포함 (toAdd만)
  // - 새 row: Qdrant에 없으므로 임베딩 생성 후 upsert
  // 참고: rowId는 컬럼 값 기반이므로, 컬럼 값이 변경되면 rowId가 변경되어 새 row로 처리됨
  const toAdd = [];
  for (const newRow of rows) {
    toAdd.push(newRow);
  }

  // 새 row와 변경된 row 개수 계산 (로깅용)
  const newRowsCount = toAdd.filter(
    (row) => !existingRowIdsFromQdrant.has(row.rowId)
  ).length;
  // 방어적 프로그래밍: newRowsCount는 toAdd.length보다 클 수 없지만 안전장치 추가
  const updatedRowsCount = Math.max(0, toAdd.length - newRowsCount);

  // 삭제 파악: 전체 newRows (FULL_GCS_PATH 또는 GCS_PATH)에 없는 row_id = 삭제 대상
  const toArchive = [];
  for (const rowId of existingRowIdsFromQdrant) {
    if (!allNewRowIds.has(rowId)) {
      toArchive.push({ rowId });
    }
  }

  // 증분 누락 진단: full JSONL에는 있지만 Qdrant에도 worker upsert 대상에도 없는 row
  // → 이번 job으로는 회복되지 않음 (GCS-only diff의 한계)
  const workerRowIdSet = new Set(toAdd.map((row) => row.rowId));
  const missingInQdrantNotHealed = [];
  for (const rowId of allNewRowIds) {
    if (!existingRowIdsFromQdrant.has(rowId) && !workerRowIdSet.has(rowId)) {
      missingInQdrantNotHealed.push(rowId);
    }
  }

  console.log("rows_classified", {
    worker_rows: rows.length,
    to_add: toAdd.length,
    to_archive: toArchive.length,
    new_rows: newRowsCount,
    updated_rows: updatedRowsCount,
    note: "변경된 row만 임베딩 생성 및 upsert (비용 절감)"
  });

  if (missingInQdrantNotHealed.length > 0) {
    const fullRowsCount =
      fullRowsCountForMetadata != null
        ? fullRowsCountForMetadata
        : allNewRowIds.size;
    const projectedQdrantAfter =
      existingRowIdsFromQdrant.size - toArchive.length + newRowsCount;
    const sampleRowIds = (ids, limit = 20) =>
      (Array.isArray(ids) ? ids : Array.from(ids)).slice(0, limit);
    const sentryKey = `ingest_integrity_gap:${tenant}:${datasetId}`;
    if (shouldSendSentry({ key: sentryKey, cooldownMs: 5 * 60 * 1000 })) {
      captureMessage(
        "ingest_integrity_gap: full JSONL rows missing from Qdrant and not in worker upsert set",
        "warning",
        {
          tenant_id: tenant || "empty",
          function_name: "ingestWorker",
          tags: {
            alert_code: "ingest_integrity_gap",
            dataset_id: datasetId,
            collection,
            job_id: jobId
          },
          fingerprint: ["ingest_integrity_gap", tenant || "empty", datasetId],
          extra: {
            alert_code: "ingest_integrity_gap",
            job_id: jobId,
            dataset_id: datasetId,
            collection,
            full_rows: fullRowsCount,
            qdrant_before: existingRowIdsFromQdrant.size,
            worker_rows: rows.length,
            to_add: toAdd.length,
            to_archive: toArchive.length,
            new_rows: newRowsCount,
            updated_rows: updatedRowsCount,
            missing_in_qdrant_not_healed: missingInQdrantNotHealed.length,
            projected_qdrant_after: projectedQdrantAfter,
            full_vs_qdrant_gap_before: Math.max(
              0,
              fullRowsCount - existingRowIdsFromQdrant.size
            ),
            sample_missing_row_ids: sampleRowIds(missingInQdrantNotHealed),
            sample_to_add_row_ids: sampleRowIds(toAdd.map((row) => row.rowId)),
            sample_to_archive_row_ids: sampleRowIds(
              toArchive.map((row) => row.rowId)
            ),
            gcs_path: gsPath || null,
            full_gcs_path: fullGsPath || null,
            risk:
              "Incremental ingest cannot restore these points; force reindex or full worker JSONL required"
          }
        }
      );
      // 성공 경로에서도 이벤트가 유실되지 않도록 flush
      await flushSentry();
    }
  }

  // ========================================================================
  // 5. 임베딩 생성 (변경된 row만: 새 row + 변경된 row)
  // ========================================================================
  // ✅ 중요: 새 row만 임베딩 생성하여 upsert (비용 절감)
  // - 새 row: 임베딩 생성 후 upsert
  // 참고: rowId는 컬럼 값 기반이므로, 컬럼 값이 변경되면 rowId가 변경되어 새 row로 처리됨
  const rowsToEmbed = toAdd; // 새 row만
  const embeddingData = rowsToEmbed.map((r) => buildEmbeddingDataFromRowText(r.text));
  const embeddingTexts = embeddingData.map((d) => d.embeddingText);
  // 임베딩 입력이 비어버리는 행은 원문 text로 fallback
  const texts = embeddingTexts.map((t, i) =>
    t && t.length > 0 ? t : (rowsToEmbed[i]?.text || "")
  );

  let vectors = [];
  let totalTokens = 0;

  if (texts.length > 0) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const embeddingResult = await embedInBatches(
      openai,
      {
        model: embedModel,
        texts,
        batchSize: embedBatch,
        maxRetries: embedMaxRetries,
        expectedDim: vectorSize,
        signal: lifecycle.signal
      },
      tenant
    );

    lifecycle.assertActive();
    vectors = embeddingResult.vectors.map(toStoredCosineVector);
    totalTokens = embeddingResult.totalTokens;
  }

  // 벡터 크기 검증 (환경변수로 받은 vectorSize와 일치하는지 확인)
  const actualVectorSize = vectors.length > 0 ? vectors[0]?.length : null;
  if (rowsToEmbed.length > 0 && !actualVectorSize) {
    throw new Error("embedding failed");
  }
  if (actualVectorSize) {
    console.log("embedding_dim", actualVectorSize);
    // 예: "text-embedding-3-small" → 1536차원

    // 환경변수로 받은 vectorSize와 실제 임베딩 결과 차원이 일치하는지 검증
    if (actualVectorSize !== vectorSize) {
      throw new Error(
        `Vector size mismatch: expected=${vectorSize} (from VECTOR_SIZE env), actual=${actualVectorSize} (from embedding result). ` +
        `Please check VECTOR_SIZE environment variable.`
      );
    }
  }

  console.log("embedding_tokens_used", {
    total_tokens: totalTokens,
    rows_embedded: rowsToEmbed.length
  });

  // ========================================================================
  // 5.5. 토큰 사용량 업데이트 (임베딩 토큰) — Qdrant upsert 실패해도 누락 방지
  // ========================================================================
  // 기존에는 Qdrant 작업 이후에 토큰 사용량을 업데이트하여,
  // 임베딩 호출(=토큰 소비) 후 Qdrant upsert 단계에서 실패하면 사용량이 누락될 수 있었습니다.
  // (예: 벡터 차원 불일치, Qdrant 4xx/5xx 등)
  // → 임베딩이 성공했고 totalTokens가 계산되었으면 즉시 누적합니다.
  if (totalTokens > 0 && tenant) {
    try {
      lifecycle.assertActive();
      // Firestore Admin SDK 초기화 (이미 초기화되어 있으면 재사용)
      if (getApps().length === 0) {
        initializeApp();
      }
      const db = getFirestore();

      const now = new Date();
      const timestamp = now.getTime();

      // 날짜 정보 생성 (usage_daily / 일일 메일·콘솔 Analytics 와 동일하게 UTC)
      const year = now.getUTCFullYear();
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");
      const day = String(now.getUTCDate()).padStart(2, "0");
      const dateKey = `${year}-${month}-${day}`;
      const monthKey = `${year}-${month}`;
      const tokenLedgerId = crypto
        .createHash("sha256")
        .update(jobId)
        .digest("hex");
      let tokenUsageApplied = false;

      await db.runTransaction(async (transaction) => {
        lifecycle.assertActive();
        tokenUsageApplied = false;
        const docRef = db.collection("tenants").doc(tenant);
        const docSnap = await transaction.get(docRef);
        if (!docSnap.exists) {
          throw new Error(`Tenant not found during token accounting: ${tenant}`);
        }

        const data = docSnap.data();
        const billing = data?.billing || {};
        const usage = data?.usage || {};
        const quota = data?.quota || {};

        const startDay = billing?.startDay != null ? billing.startDay : now.getDate();
        let existingWindowStartAt = billing?.windowStartAt ? new Date(billing.windowStartAt) : null;
        let existingWindowEndAt = billing?.windowEndAt ? new Date(billing.windowEndAt) : null;

        let windowStartAt = existingWindowStartAt;
        let windowEndAt = existingWindowEndAt;
        let shouldResetBillingMonth = false;

        if (existingWindowEndAt && isBillingWindowExpired(existingWindowEndAt, now)) {
          const newWindow = calculateBillingWindow(now, startDay, existingWindowStartAt);
          windowStartAt = newWindow.windowStartAt;
          windowEndAt = newWindow.windowEndAt;
          shouldResetBillingMonth = true;
        } else if (!existingWindowStartAt || !existingWindowEndAt) {
          const newWindow = calculateBillingWindow(now, startDay, null);
          windowStartAt = newWindow.windowStartAt;
          windowEndAt = newWindow.windowEndAt;
        }

        const billingKey = generateBillingKey(windowStartAt, windowEndAt);

        const dailyRef = db
          .collection("tenants")
          .doc(tenant)
          .collection("usage_daily")
          .doc(dateKey);
        const monthlyRef = db
          .collection("tenants")
          .doc(tenant)
          .collection("usage_monthly")
          .doc(monthKey);
        const billingRef = db
          .collection("tenants")
          .doc(tenant)
          .collection("usage_billing")
          .doc(billingKey);
        const tokenLedgerRef = db
          .collection("tenants")
          .doc(tenant)
          .collection("ingest_token_usage_ledger")
          .doc(tokenLedgerId);
        const [dailySnap, monthlySnap, billingSnap, tokenLedgerSnap] =
          await Promise.all([
            transaction.get(dailyRef),
            transaction.get(monthlyRef),
            transaction.get(billingRef),
            transaction.get(tokenLedgerRef)
          ]);

        if (tokenLedgerSnap.exists && tokenLedgerSnap.data()?.applied === true) {
          tokenUsageApplied = false;
          return;
        }

        const baseTokenLimit = quota.token_limit_month || Infinity;
        const currentTokenUsedBillingMonth = shouldResetBillingMonth
          ? 0
          : usage.token_used_billing_month || 0;

        let usedFromBasePlan = 0;
        let remainingForAddon = totalTokens;
        if (baseTokenLimit !== Infinity) {
          const availableInBasePlan = Math.max(0, baseTokenLimit - currentTokenUsedBillingMonth);
          usedFromBasePlan = Math.max(0, Math.min(totalTokens, availableInBasePlan));
          remainingForAddon = Math.max(0, totalTokens - usedFromBasePlan);
        } else {
          usedFromBasePlan = totalTokens;
          remainingForAddon = 0;
        }

        let addonTokenArray = Array.isArray(data?.addon_token) ? data.addon_token : [];
        let updatedAddonTokenArray = processAddonStatus(addonTokenArray, timestamp);

        let usedFromAddon = 0;
        if (remainingForAddon > 0) {
          const addonResult = consumeAddonTokens(updatedAddonTokenArray, remainingForAddon, timestamp);
          usedFromAddon = addonResult.usedFromAddon;
          updatedAddonTokenArray = addonResult.updated;
        }
        if (!Array.isArray(updatedAddonTokenArray)) updatedAddonTokenArray = [];

        const lastUpdatedDate = usage?.lastUpdatedDate;
        const lastUpdatedMonth = usage?.lastUpdatedMonth;
        const shouldResetToday = lastUpdatedDate && lastUpdatedDate !== dateKey;
        const shouldResetMonth = lastUpdatedMonth && lastUpdatedMonth !== monthKey;

        const updateData = {
          usage: {
            lastUpdatedDate: dateKey,
            lastUpdatedMonth: monthKey
          },
          billing: {
            ...billing,
            startDay: billing?.startDay != null ? billing.startDay : startDay,
            windowStartAt: windowStartAt.getTime(),
            windowEndAt: windowEndAt.getTime()
          },
          addon_token: updatedAddonTokenArray
        };

        updateData.usage.token_used_today = shouldResetToday
          ? totalTokens
          : FieldValue.increment(totalTokens);
        updateData.usage.token_used_month = shouldResetMonth
          ? totalTokens
          : FieldValue.increment(totalTokens);

        const safeUsedFromBasePlan = Math.max(0, usedFromBasePlan);
        if (shouldResetBillingMonth) {
          updateData.usage.token_used_billing_month = safeUsedFromBasePlan;
        } else if (safeUsedFromBasePlan > 0) {
          updateData.usage.token_used_billing_month = FieldValue.increment(safeUsedFromBasePlan);
        }
        if (usedFromAddon > 0) {
          const currentAddonUsed = usage.token_used_addon_token || 0;
          updateData.usage.token_used_addon_token = currentAddonUsed + usedFromAddon;
        }

        transaction.set(docRef, updateData, { merge: true });

        const dailyPayload = {
          date_key: dateKey,
          month_key: monthKey,
          tenant_id: tenant,
          tokens: { total: FieldValue.increment(totalTokens) },
          updated_at: timestamp
        };
        if (!dailySnap.exists) dailyPayload.created_at = timestamp;
        transaction.set(dailyRef, dailyPayload, { merge: true });

        const monthlyPayload = {
          month_key: monthKey,
          tokens: { total: FieldValue.increment(totalTokens) },
          tenant_id: tenant,
          updated_at: timestamp
        };
        if (!monthlySnap.exists) monthlyPayload.created_at = timestamp;
        transaction.set(monthlyRef, monthlyPayload, { merge: true });

        const totalUsageForBilling = safeUsedFromBasePlan + usedFromAddon;
        const billingPayload = {
          billingKey,
          tokens: { total: FieldValue.increment(totalUsageForBilling) },
          windowStart: formatDateString(windowStartAt),
          windowEnd: formatDateString(windowEndAt),
          tenant_id: tenant,
          updated_at: timestamp
        };
        if (!billingSnap.exists) billingPayload.created_at = timestamp;
        transaction.set(billingRef, billingPayload, { merge: true });

        // 월별 감사 (audit_monthly) — 임베딩 토큰 모델/목적별 집계
        const auditRef = db
          .collection("tenants")
          .doc(tenant)
          .collection("audit_monthly")
          .doc(monthKey);
        const auditModelKey = (embedModel || "unknown").replace(/[.-]/g, "_");
        const auditPurpose = "embedding";
        transaction.set(
          auditRef,
          {
            month_key: monthKey,
            updated_at: timestamp,
            [`by_model.${auditModelKey}.input_tokens`]: FieldValue.increment(totalTokens),
            [`by_model.${auditModelKey}.output_tokens`]: FieldValue.increment(0),
            [`by_purpose.${auditPurpose}.input_tokens`]: FieldValue.increment(totalTokens),
            [`by_purpose.${auditPurpose}.output_tokens`]: FieldValue.increment(0)
          },
          { merge: true }
        );

        // job별 ledger와 모든 usage 증분을 같은 transaction에 기록해 exactly-once를 보장한다.
        // expires_at에는 Firestore TTL 정책(예: 90일)을 설정할 수 있다. 이 컬렉션은 조회용이
        // 아니므로 운영 시 applied/job_id 등 불필요한 collection-group index를 면제해 비용을 줄인다.
        transaction.create(tokenLedgerRef, {
          applied: true,
          job_id: jobId,
          job_id_hash: tokenLedgerId,
          tenant_id: tenant,
          dataset_id: datasetId,
          embed_model: embedModel,
          total_tokens: totalTokens,
          billing_key: billingKey,
          applied_at: timestamp,
          expires_at: new Date(timestamp + 90 * 24 * 60 * 60 * 1000)
        });
        tokenUsageApplied = true;
      });
      lifecycle.assertActive();

      console.log(
        tokenUsageApplied
          ? "token_usage_updated"
          : "token_usage_already_applied",
        {
          tenant,
          dataset_id: datasetId,
          job_id: jobId,
          total_tokens: totalTokens
        }
      );
    } catch (tokenUpdateError) {
      console.error("token_usage_update_failed", {
        tenant,
        error: tokenUpdateError?.message || String(tokenUpdateError),
        stack: tokenUpdateError?.stack
      });
      captureError(tokenUpdateError, {
        tenant_id: tenant || "empty",
        function_name: "main",
        extra: { stage: "token_usage_after_embedding" }
      });
      throw new IngestExecutionError("Token usage accounting failed", {
        cause:
          tokenUpdateError instanceof Error
            ? tokenUpdateError
            : new Error(String(tokenUpdateError)),
        retryable: true,
        code: "TOKEN_USAGE_ACCOUNTING_FAILED"
      });
    }
  }

  // ========================================================================
  // 6. 포인트 준비 및 Upsert (새 row만: rowId는 컬럼 값 기반이므로 변경 시 새 rowId로 처리됨)
  // ========================================================================
  // 변경된 row만 Qdrant에 저장할 포인트 배열을 생성합니다.
  // 각 포인트는 ID, 벡터, 메타데이터(payload)를 포함합니다.
  //
  // 포인트 ID 생성:
  // - row.rowId는 이미 tenant|datasetId|content를 포함한 해시이므로
  //   추가 해시 없이 row.rowId를 직접 UUID 형식으로 변환
  // - 동일한 row.rowId에 대해 항상 동일한 point ID가 생성됨 (결정적)
  //
  // ✅ 중요: 변경된 row만 upsert (비용 절감)
  // - 새 row: 임베딩 생성 후 upsert
  // - 변경된 row: 내용이 변경되었으므로 임베딩 생성 후 upsert

  const VECTOR_EMBEDDING = "embedding";
  const VECTOR_BM25 = "bm25";

  const points = rowsToEmbed.map((row, idx) => {
    const pointId = hexToUuid(row.rowId);
    const embeddingText = embeddingTexts[idx] || "";
    // Sparse/BM25는 raw row text를 그대로 보존해
    // schema-like 키 토큰의 lexical recall을 유지한다.
    const bm25Input = row.text || embeddingText;
    const bm25 = textToBm25Sparse(bm25Input);
    return {
      id: pointId,
      vector: {
        [VECTOR_EMBEDDING]: vectors[idx],
        [VECTOR_BM25]: bm25.indices.length ? bm25 : { indices: [0], values: [0] }
      },
      payload: {
        tenant,
        dataset: datasetId,
        row_id: row.rowId,
        embed_model: embedModel,
        text: row.text,
        embedding_text: embeddingText,
        version: row.version || 1,
        row_kind_guess: row?.rowMeta?.row_kind_guess || "unknown",
        is_long_text: row?.rowMeta?.is_long_text === true,
        has_section_marker: row?.rowMeta?.has_section_marker === true,
        policy_like: row?.rowMeta?.policy_like === true,
        faq_like: row?.rowMeta?.faq_like === true
      }
    };
  });

  // ✅ 방어: 배치 업서트 전에 벡터 차원 전량 검증 (혼입 방지)
  // - "embedding_dim 1536"인데도 upsert에서 "got 384"가 발생한 케이스 대응
  if (points.length > 0) {
    const expectedDim = vectorSize;
    let badCount = 0;
    const badSamples = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const embVec = p?.vector?.[VECTOR_EMBEDDING];
      const len = Array.isArray(embVec) ? embVec.length : null;
      if (!len || len !== expectedDim) {
        badCount += 1;
        if (badSamples.length < 5) {
          badSamples.push({
            idx: i,
            row_id: p?.payload?.row_id || null,
            vector_meta: safePreviewArrayLengths(embVec)
          });
        }
      }
    }
    if (badCount > 0) {
      const err = new Error(
        `Invalid embedding vector dimension in points: expected=${expectedDim}, bad_count=${badCount}`
      );
      err.status = 400;
      console.error("invalid_embedding_vector_dimension", {
        tenant,
        dataset_id: datasetId,
        expected_dim: expectedDim,
        bad_count: badCount,
        bad_samples: badSamples
      });
      throw err;
    }
  }

  // dataset별 평균 임베딩 계산 (검색 시 dataset 선정용, 10만 건 이상일 때 사용)
  let embedValue = null;
  let embedValueCount = null;
  let embedValueInvalid = false;
  const getOldVectorsForMean = async (rowIds) => {
    try {
      const oldVectors = await qdrant.getEmbeddingVectorsByRowIds(collection, {
        tenant, dataset: datasetId, rowIds
      });
      if (rowIds.some(rowId => !oldVectors.has(rowId))) {
        throw new Error("Missing old vectors for dataset mean");
      }
      return oldVectors;
    } catch (error) {
      lifecycle.assertActive(); // 취소/타임아웃은 완료로 처리하지 않는다.
      embedValueInvalid = true;
      console.warn("embed_value_lookup_failed_skip", {
        tenant, dataset_id: datasetId, message: error?.message || String(error)
      });
      return new Map();
    }
  };
  if (!rebuildEmbedValueFromQdrant && (vectors.length > 0 || toArchive.length > 0)) {
    const dim = vectors.length > 0 ? vectors[0].length : vectorSize;
    const existingCountBefore = existingRowIdsFromQdrant.size;
    const maxOldVectorsFetch = Number(
      process.env.EMBED_VALUE_MAX_OLD_VECTORS_FETCH || "2000"
    );
    const sampleUpdatedSize = Number(
      process.env.EMBED_VALUE_SAMPLE_UPDATED || "400"
    );
    const sampleDeletedSize = Number(
      process.env.EMBED_VALUE_SAMPLE_DELETED || "400"
    );

    // Qdrant에 이미 있는 ID의 재임베딩은 이전 벡터를 빼고 새 벡터로 교체한다.
    const newRowIds = [];
    const updatedRowIds = [];
    const newVecByRowId = new Map();
    const updatedVecByRowId = new Map();
    for (let i = 0; i < rowsToEmbed.length; i++) {
      const rid = rowsToEmbed[i].rowId;
      const vec = vectors[i];
      if (!rid || !vec) continue;
      if (existingRowIdsFromQdrant.has(rid)) {
        updatedRowIds.push(rid);
        updatedVecByRowId.set(rid, vec);
      } else {
        newRowIds.push(rid);
        newVecByRowId.set(rid, vec);
      }
    }
    const archiveRowIds = toArchive.map((a) => a.rowId).filter(Boolean);
    const needOldRowIds = Array.from(new Set([...updatedRowIds, ...archiveRowIds]));

    // 이전 평균 벡터를 기반으로 sum을 만든 뒤 델타 적용
    let prevCount =
      previousEmbedValueCount != null ? previousEmbedValueCount : existingCountBefore;
    if (
      previousEmbedValueCount != null &&
      existingCountBefore > 0 &&
      Math.abs(previousEmbedValueCount - existingCountBefore) >
        Math.max(50, existingCountBefore * 0.05)
    ) {
      console.warn("embed_value_count_mismatch", {
        tenant,
        dataset_id: datasetId,
        previousEmbedValueCount,
        existingCountBefore,
        message: "Using existingCountBefore for embed_value update"
      });
      prevCount = existingCountBefore;
    }

    // 이전 embed_value가 없는데 기존 데이터가 있으면 잘못된 평균을 만들 위험이 크므로 스킵
    if (!previousEmbedValue && existingCountBefore > 0) {
      console.warn("embed_value_missing_skip_update", {
        tenant,
        dataset_id: datasetId,
        existingCountBefore,
        message:
          "Previous embed_value missing; skipping embed_value update to avoid biased mean"
      });
    } else {
      const sum =
        previousEmbedValue && prevCount > 0
          ? scaleVector(previousEmbedValue, prevCount)
          : new Array(dim).fill(0);

      let oldVecMap = new Map();
      let approxMode = false;
      let approxSamples = { updated: 0, deleted: 0 };
      let approxCounts = {
        updated_total: updatedRowIds.length,
        deleted_total: archiveRowIds.length
      };

      const largeChangeStrategyRaw = String(
        process.env.EMBED_VALUE_LARGE_CHANGE_STRATEGY || "auto"
      ).toLowerCase(); // "auto" | "sample" | "skip"

      const existingCountSafe = Math.max(0, existingCountBefore || 0);
      const changeRatio =
        existingCountSafe > 0 ? needOldRowIds.length / existingCountSafe : 0;

      // 자동 전략:
      // - old-vector 조회량이 너무 크거나(시간/비용↑), 변경 비율이 높으면 skip(count만 갱신)
      // - 그 외에는 sample로 근사 업데이트
      // - 전량 조회(정확)는 needOldRowIds <= maxOldVectorsFetch일 때만 수행
      const autoStrategy = (() => {
        if (needOldRowIds.length <= maxOldVectorsFetch) return "exact";
        if (existingCountSafe === 0) return "sample";
        if (needOldRowIds.length >= maxOldVectorsFetch * 3) return "skip";
        if (needOldRowIds.length >= 5000) return "skip";
        if (changeRatio >= 0.2) return "skip";
        if (archiveRowIds.length >= Math.max(500, existingCountSafe * 0.1)) return "skip";
        return "sample";
      })();

      const effectiveStrategy =
        largeChangeStrategyRaw === "auto"
          ? autoStrategy
          : largeChangeStrategyRaw === "skip"
            ? "skip"
            : "sample";

      if (needOldRowIds.length <= maxOldVectorsFetch) {
        oldVecMap = await getOldVectorsForMean(needOldRowIds);
      } else {
        if (effectiveStrategy === "skip") {
          console.warn("embed_value_large_change_skip", {
            tenant,
            dataset_id: datasetId,
            need_old_vectors: needOldRowIds.length,
            max_old_vectors_fetch: maxOldVectorsFetch,
            change_ratio: changeRatio,
            strategy_raw: largeChangeStrategyRaw,
            strategy_effective: effectiveStrategy,
            message:
              "Large change detected; skipping embed_value update (count will be updated)"
          });
          // embed_value는 갱신하지 않고 count만 저장되도록 둠
          approxMode = true;
          approxCounts = {
            updated_total: updatedRowIds.length,
            deleted_total: archiveRowIds.length
          };
          // additions만 반영해도 bias 가능 → 안전하게 sum 변경 없이 종료
          // finalCount는 아래에서 embedValueCount로만 반영될 수 있음
        } else {
        // 대규모 변경: 샘플링 기반 근사 업데이트 (embed_value는 dataset 선택용이므로 근사 허용)
        approxMode = true;
        const sampledUpdated = sampleArray(
          updatedRowIds,
          Math.min(sampleUpdatedSize, updatedRowIds.length)
        );
        const sampledDeleted = sampleArray(
          archiveRowIds,
          Math.min(sampleDeletedSize, archiveRowIds.length)
        );
        approxSamples = { updated: sampledUpdated.length, deleted: sampledDeleted.length };
        const sampledNeed = Array.from(new Set([...sampledUpdated, ...sampledDeleted]));

        oldVecMap = await getOldVectorsForMean(sampledNeed);

        console.warn("embed_value_approx_mode", {
          tenant,
          dataset_id: datasetId,
          need_old_vectors: needOldRowIds.length,
          max_old_vectors_fetch: maxOldVectorsFetch,
          change_ratio: changeRatio,
          strategy_raw: largeChangeStrategyRaw,
          strategy_effective: effectiveStrategy,
          sampled_updated: sampledUpdated.length,
          sampled_deleted: sampledDeleted.length,
          message: "Using sampling-based approximate embed_value update"
        });

        // 근사 델타: 업데이트/삭제는 샘플 평균으로 스케일링
        if (sampledUpdated.length > 0) {
          const oldUpdated = [];
          const newUpdated = [];
          for (const rid of sampledUpdated) {
            const oldV = oldVecMap.get(rid);
            const newV = updatedVecByRowId.get(rid);
            if (oldV && newV) {
              oldUpdated.push(oldV);
              newUpdated.push(newV);
            }
          }
          const meanOld = meanVector(oldUpdated, dim);
          const meanNew = meanVector(newUpdated, dim);
          if (meanOld && meanNew) {
            // sum += (meanNew - meanOld) * updated_total
            for (let i = 0; i < dim; i++) {
              sum[i] += (meanNew[i] - meanOld[i]) * updatedRowIds.length;
            }
          }
        }
        if (sampledDeleted.length > 0) {
          const oldDeleted = [];
          for (const rid of sampledDeleted) {
            const oldV = oldVecMap.get(rid);
            if (oldV) oldDeleted.push(oldV);
          }
          const meanOldDel = meanVector(oldDeleted, dim);
          if (meanOldDel) {
            for (let i = 0; i < dim; i++) {
              sum[i] -= meanOldDel[i] * archiveRowIds.length;
            }
          }
        }
        }
      }

      // additions (skip 모드에서는 embed_value 자체를 갱신하지 않으므로 sum 변경을 피함)
      if (!(approxMode && effectiveStrategy === "skip")) {
        for (const rid of newRowIds) {
          const v = newVecByRowId.get(rid);
          if (v) addVectorsInPlace(sum, v);
        }
      }

      let updatedMissingOld = 0;
      let deletedMissingOld = 0;
      if (!approxMode) {
        // updates: sum += new - old
        for (const rid of updatedRowIds) {
          const newV = updatedVecByRowId.get(rid);
          const oldV = oldVecMap.get(rid);
          if (!newV || !oldV) {
            updatedMissingOld += 1;
            continue;
          }
          addVectorsInPlace(sum, newV);
          subVectorsInPlace(sum, oldV);
        }

        // deletes: sum -= old
        for (const rid of archiveRowIds) {
          const oldV = oldVecMap.get(rid);
          if (!oldV) {
            deletedMissingOld += 1;
            continue;
          }
          subVectorsInPlace(sum, oldV);
        }
      }

      // 새로운 총 row 수 (가능하면 FULL 파일 기준)
      const computedCount = existingCountBefore + newRowIds.length - archiveRowIds.length;
      const finalCount =
        fullRowsCountForMetadata != null ? fullRowsCountForMetadata : computedCount;

      if (finalCount > 0 && !(approxMode && effectiveStrategy === "skip")) {
        embedValue = new Array(dim);
        for (let i = 0; i < dim; i++) embedValue[i] = sum[i] / finalCount;
        embedValueCount = finalCount;
      } else if (finalCount > 0 && (approxMode && effectiveStrategy === "skip")) {
        embedValueCount = finalCount;
      }

      if (!approxMode && (updatedMissingOld || deletedMissingOld)) {
        console.warn("embed_value_old_vectors_missing", {
          tenant,
          dataset_id: datasetId,
          updatedMissingOld,
          deletedMissingOld,
          message: "Some old vectors missing; embed_value update may be approximate"
        });
      }
    }
  }

  if (embedValueInvalid) {
    embedValue = null;
    embedValueCount = null;
  }

  // ========================================================================
  // 7. 배치 단위로 Upsert (새 row만)
  // ========================================================================
  // 포인트를 배치 단위로 나누어 Qdrant에 삽입/업데이트합니다.
  // 배치 크기: 200개 (Qdrant API 성능 최적화)
  //
  // ✅ 중요: 새 row만 upsert (비용 절감)
  // 참고: rowId는 컬럼 값 기반이므로, 컬럼 값이 변경되면 rowId가 변경되어 삭제 후 추가로 처리됨
  //
  // ⚠️ 순서 주의: Upsert → Delete 순서 유지 (데이터 손실 방지)
  // - Upsert 먼저: 새 데이터를 먼저 저장 → 실패 시 기존 데이터 유지 (안전)
  // - Delete 나중: Upsert 성공 후 이전 데이터 삭제 → 실패 시 중복 데이터 가능하지만 재시도 가능
  // - 반대로 하면: Delete → Upsert 실패 시 데이터 손실 발생 (복구 불가)

  const BATCH = 200; // 배치 크기
  let upsertCompleted = false;
  let deleteCompleted = false;

  try {
    // Upsert 먼저 실행 (안전 우선)
    if (points.length > 0) {
      for (let i = 0; i < points.length; i += BATCH) {
        const batch = points.slice(i, i + BATCH); // 배치 추출
        lifecycle.assertActive();
        await qdrant.upsertPoints(collection, batch);
        lifecycle.assertActive();
        console.log("upserted", {
          from: i,
          to: Math.min(points.length, i + BATCH)
        });
      }
    }
    upsertCompleted = true; // Upsert 완료 표시

    // ========================================================================
    // 8. 벡터 DB 삭제 (Qdrant에서 삭제)
    // ========================================================================
    // 삭제된 rows를 Qdrant에서 삭제 (JSONL로 관리, Firestore rows 불필요)
    // Upsert 성공 후에만 Delete 실행 (데이터 손실 방지)
    if (toArchive.length > 0) {
      const archiveRowIds = toArchive.map((a) => a.rowId);
      console.log("deleting_rows_from_qdrant", {
        tenant,
        dataset_id: datasetId,
        count: archiveRowIds.length
      });

      // 벡터 DB에서 삭제 (docId 필터 제거: row별 관리)
      lifecycle.assertActive();
      await qdrant.deleteByRowIds(collection, {
        tenant,
        dataset: datasetId,
        rowIds: archiveRowIds
      });
      lifecycle.assertActive();

      console.log("deleted_rows_completed", {
        tenant,
        dataset_id: datasetId,
        count: archiveRowIds.length
      });
    }
    // toArchive가 비어있어도 Delete 작업은 완료로 처리 (삭제할 것이 없음)
    deleteCompleted = true; // Delete 완료 표시
  } catch (error) {
    // 에러 발생 시 처리
    const errorMessage = error?.message || String(error);
    const errorStack = error?.stack;

    if (!upsertCompleted) {
      // Upsert 실패: 기존 데이터는 유지됨 (안전)
      console.error("upsert_failed", {
        tenant,
        dataset_id: datasetId,
        error: errorMessage,
        stack: errorStack,
        message: "Upsert failed, existing data preserved. Delete not executed."
      });

      // Sentry로 에러 전송
      captureError(error, {
        tenant_id: tenant || "empty",
        function_name: "main",
        extra: {
          dataset_id: datasetId,
          operation: "upsert",
          message: "Upsert failed, existing data preserved"
        }
      });

      throw error; // 에러를 다시 throw하여 프로세스 종료
    } else if (!deleteCompleted) {
      // Upsert 성공했지만 Delete 실패: 새 데이터는 저장됨, 이전 데이터가 남을 수 있음 (중복 가능)
      // 이 경우는 복구 가능하므로 경고만 출력하고 계속 진행 (다음 작업에서 정리 가능)
      console.warn("delete_failed_after_upsert", {
        tenant,
        dataset_id: datasetId,
        error: errorMessage,
        stack: errorStack,
        message:
          "Delete failed after upsert succeeded. New data is saved, but old data may remain. Retry recommended."
      });

      // Sentry로 경고 전송 (에러보다 낮은 레벨)
      captureError(error, {
        tenant_id: tenant || "empty",
        function_name: "main",
        extra: {
          dataset_id: datasetId,
          operation: "delete_after_upsert",
          severity: "warning",
          message:
            "Delete failed after upsert. Data inconsistency possible but recoverable."
        }
      });

      // ⚠️ 운영 중에는 Delete 실패 시에도 작업을 완료로 처리 (중복 데이터 가능하지만 다음 작업에서 정리)
      // 또는 throw하여 재시도 가능하게 할 수도 있음 (현재는 경고만)
      // throw error; // 필요 시 주석 해제하여 재시도 유도
    }

    // 예상치 못한 에러
    throw error;
  }

  // 부분 성공 재시도 또는 이전 버전 평균은 현재 Qdrant를 기준으로 복원한다.
  // Upsert/Delete가 모두 성공한 뒤에만 현재 전체 벡터를 읽는다 (쓰기/재임베딩 없음).
  if (rebuildEmbedValueFromQdrant) {
    lifecycle.assertActive();
    try {
      const recovered = await readDatasetMeanEmbedding(qdrant, collection, {
        tenant, dataset: datasetId, vectorSize: actualVectorSize || vectorSize
      });
      embedValue = recovered.embedValue;
      embedValueCount = recovered.embedValueCount;
    } catch (error) {
      lifecycle.assertActive();
      embedValueInvalid = true;
      embedValue = null;
      embedValueCount = null;
      console.warn("embed_value_recovery_failed_skip", {
        tenant, dataset_id: datasetId, message: error?.message || String(error)
      });
    }
    lifecycle.assertActive();
  }

  // ========================================================================
  // 9. 토큰 사용량 업데이트
  // ========================================================================
  // 임베딩 생성에 사용된 토큰을 Firestore에 업데이트합니다.
  // ========================================================================
  // 10. Dataset 상태 업데이트 및 jsonl_paths 저장 (작업 완료)
  // ========================================================================
  // 벡터 DB 저장이 완료되었으므로 상태를 "ready"로 변경하고
  // fullJsonlGcsPath를 jsonl_paths에 저장 (다음번 업로드 시 oldJsonlPath로 사용)
  // ✅ 중요: jsonl_paths는 작업이 성공적으로 완료된 후에만 저장하여 데이터 일관성 보장
  try {
    if (getApps().length === 0) {
      initializeApp();
    }
    const db = getFirestore();

    const datasetRef = db
      .collection("tenants")
      .doc(tenant)
      .collection("datasets")
      .doc(datasetId);

    // fullJsonlGcsPath가 있으면 jsonl_paths에 추가 (작업 성공 시에만 저장)
    const updateData = {
      status: DatasetStatus.READY,
      processing_job_id: FieldValue.delete(), // 작업 완료 시 processing_job_id 제거
      updated_at: Date.now(),
      error: "" // 성공 시 이전 실패 시 저장된 error 초기화
    };

    // 빈 데이터셋을 복구한 경우에도 이전 평균을 남기지 않는다.
    if (rebuildEmbedValueFromQdrant) {
      updateData.embed_value = embedValue;
      updateData.embed_value_count = embedValueCount;
    }
    // dataset별 평균 임베딩 저장 (검색 시 10만 건 이상일 때 dataset 선정용)
    if (embedValue && embedValue.length > 0) {
      updateData.embed_value = embedValue;
      if (typeof embedValueCount === "number" && embedValueCount > 0) {
        updateData.embed_value_count = embedValueCount;
      }
    }
    if (rebuildEmbedValueFromQdrant || (embedValue && embedValue.length > 0)) {
      updateData.embed_value_basis = EMBED_VALUE_BASIS;
    }
    // 실패한 평균과 개수를 함께 무효화해 다음 증분의 기준으로 재사용하지 않는다.
    if (embedValueInvalid) {
      updateData.embed_value = null;
      updateData.embed_value_count = FieldValue.delete();
      updateData.embed_value_basis = FieldValue.delete();
    }
    // embed_value는 기존값 유지하되, 전체 row count를 알고 있으면 count는 보정 저장
    if (
      !embedValueInvalid &&
      updateData.embed_value_count == null &&
      fullRowsCountForMetadata != null &&
      fullRowsCountForMetadata > 0
    ) {
      updateData.embed_value_count = fullRowsCountForMetadata;
    }

    // FULL_GCS_PATH가 있으면 jsonl_paths에 추가 (작업 성공 시에만 저장)
    if (
      deleteDetectionGsPath &&
      deleteDetectionGsPath !== gsPath &&
      fullRowsCountForMetadata != null
    ) {
      // 전체 JSONL 경로를 jsonl_paths에 추가
      // 이 경로는 다음번 uploadDataset.js에서 oldJsonlPath로 사용됨
      updateData.jsonl_paths = FieldValue.arrayUnion({
        gcs_path: deleteDetectionGsPath,
        created_at: Date.now(),
        rows_count: fullRowsCountForMetadata, // 전체 row 수
        to_add_count: newRowsCount, // 새로 추가된 row 수
        to_update_count: updatedRowsCount, // 변경된 row 수
        to_archive_count: toArchive.length // 삭제된 row 수
      });
    }

    lifecycle.assertActive();
    let statusUpdated = false;
    await db.runTransaction(async (transaction) => {
      statusUpdated = false;
      const snapshot = await transaction.get(datasetRef);
      if (
        !snapshot.exists ||
        snapshot.data()?.processing_job_id !== jobId
      ) {
        return;
      }
      transaction.set(datasetRef, updateData, { merge: true });
      statusUpdated = true;
    });

    // 작업 완료 시 tenant 문서의 status를 "active"로 변경
    if (statusUpdated) {
      const tenantRef = db.collection("tenants").doc(tenant);
      try {
        await tenantRef.set(
          { status: "active", updated_at: Date.now() },
          { merge: true }
        );
      } catch (tenantStatusError) {
        console.warn("tenant_status_update_failed", {
          tenant,
          dataset_id: datasetId,
          error: tenantStatusError?.message || String(tenantStatusError)
        });
        captureError(
          tenantStatusError instanceof Error
            ? tenantStatusError
            : new Error(String(tenantStatusError)),
          {
            tenant_id: tenant || "empty",
            function_name: "ingestWorker",
            extra: {
              dataset_id: datasetId,
              job_id: jobId,
              operation: "tenant_status_active",
              alert_code: "ingest_tenant_status_update_failed"
            }
          }
        );
      }
    }

    console.log("dataset_status_updated", {
      tenant,
      dataset_id: datasetId,
      status: DatasetStatus.READY,
      full_jsonl_path:
        deleteDetectionGsPath !== gsPath ? deleteDetectionGsPath : null,
      job_id: jobId,
      status_updated: statusUpdated,
      message: statusUpdated
        ? "Dataset status updated to ready and jsonl_paths updated"
        : "Dataset ready update skipped because job ownership changed"
    });
    if (statusUpdated) {
      console.log("tenant_status_updated", {
        tenant,
        status: "active",
        message: "Tenant status set to active after job completion"
      });
    }
  } catch (statusUpdateError) {
    console.error("dataset_status_update_failed", {
      tenant,
      dataset_id: datasetId,
      error: statusUpdateError?.message || String(statusUpdateError),
      stack: statusUpdateError?.stack
    });

    // Sentry로 에러 전송
    captureError(statusUpdateError, {
      tenant_id: tenant || "empty",
      function_name: "main",
      extra: {
        dataset_id: datasetId,
        message: "Dataset status update failed"
      }
    });
    throw new IngestExecutionError("Dataset READY status update failed", {
      cause:
        statusUpdateError instanceof Error
          ? statusUpdateError
          : new Error(String(statusUpdateError)),
      retryable: true,
      code: "DATASET_READY_UPDATE_FAILED"
    });
  }

  // ========================================================================
  // 11. 완료 로그
  // ========================================================================
  const elapsedMs = Date.now() - jobStartedAt;
  const elapsedSeconds = (elapsedMs / 1000).toFixed(2);

  console.log("done", {
    jobId, // 작업 ID
    tenant, // 테넌트 ID
    dataset_id: datasetId, // 데이터셋 ID
    total: points.length, // 총 포인트 수 (변경된 것만)
    to_add: toAdd.length,
    to_archive: toArchive.length,
    collection, // 컬렉션 이름
    embedModel, // 임베딩 모델
    qdrantUrl, // Qdrant URL
    total_tokens: totalTokens, // 사용된 토큰 수
    elapsed_ms: elapsedMs, // 작업 시작 ~ 종료 소요 시간 (ms)
    elapsed_seconds: elapsedSeconds // 작업 시작 ~ 종료 소요 시간 (초)
  });

  return {
    outcome: "completed",
    skipped: false,
    retryable: false,
    tenant,
    datasetId,
    jobId,
    collection,
    total: points.length,
    toAdd: toAdd.length,
    toArchive: toArchive.length,
    totalTokens,
    elapsedMs
  };
}

// ============================================================================
// Schema Version 상태 업데이트 제거
// ============================================================================
// 버전 관리는 row별로만 수행 (dataset별 versions 컬렉션 제거)

// ============================================================================
// 메인 함수 실행 및 에러 처리
// ============================================================================

/**
 * 오류가 재시도 가능한지 판단
 *
 * 재시도 가능한 오류: 네트워크 오류, 일시적 서비스 장애 등 재시도로 해결될 수 있는 오류
 * 재시도 불가능한 오류: 타임아웃, 설정 오류, 데이터 오류 등 재시도해도 해결되지 않는 오류
 *
 * 판단 순서:
 * 1. 재시도 불가능한 패턴이 포함되어 있으면 → 재시도 불가
 * 2. 재시도 가능한 패턴이 포함되어 있으면 → 재시도 가능
 * 3. HTTP 상태 코드가 5xx이면 → 재시도 가능
 * 4. 기본값 → 재시도 불가 (안전하게 처리)
 *
 * @param {Error} error - 에러 객체
 * @returns {boolean} - 재시도 가능 여부 (true: 재시도 가능, false: 재시도 불가능)
 *
 * @example
 * isRetryableError(new Error("ECONNREFUSED")) // true (네트워크 오류)
 * isRetryableError(new TypeError("fetch failed")) // true (undici 네트워크 오류)
 * isRetryableError(new Error("Job timeout")) // false (작업 타임아웃)
 * isRetryableError(new Error("TENANT is required")) // false (설정 오류)
 */
function isRetryableError(error) {
  // undici 등: message는 "fetch failed"이고 실제 원인은 error.cause에 있는 경우가 많음
  const cause = error?.cause;
  const errorMessage = [
    error?.message,
    error?.code,
    cause?.message,
    cause?.code,
    cause?.errno,
    cause?.syscall
  ]
    .filter((v) => v != null && String(v).trim() !== "")
    .map((v) => String(v).toLowerCase())
    .join(" ");
  const errorStatus = error?.status || error?.statusCode || 0;

  // 재시도 가능한 오류 패턴
  const retryablePatterns = [
    // 네트워크 오류 (Node fetch/undici: TypeError "fetch failed")
    "fetch failed",
    "econnrefused",
    "econnreset",
    "etimedout",
    "econnaborted",
    "epipe",
    "timed out",
    "abort",
    "aborted",
    "enotfound",
    "eai_again",
    "network",
    "connection",
    "connection timeout", // 네트워크 연결 타임아웃 (일시적)
    // GCS 오류
    "storage",
    "bucket",
    "download",
    // Qdrant 오류
    "qdrant",
    "connection refused",
    // Firestore 오류
    "firestore",
    "deadline exceeded",
    // 일시적 서비스 오류
    "503",
    "502",
    "504",
    "service unavailable",
    "bad gateway",
    "gateway timeout"
  ];

  // 재시도 불가능한 오류 패턴 (설정 오류, 데이터 오류 등)
  const nonRetryablePatterns = [
    // 설정 오류
    "is required",
    "invalid",
    "missing",
    "not found",
    // 데이터 오류
    "vector size mismatch",
    "vector dimension error",
    "invalid embedding vector dimension",
    "no valid rows",
    "parsing",
    // 동시 실행 오류
    "another indexing job",
    "already running",
    // 타임아웃 (데이터가 너무 많음)
    "job timeout",
    "execution exceeded"
  ];

  // 재시도 불가능한 오류가 포함되어 있으면 재시도 불가
  if (nonRetryablePatterns.some((pattern) => errorMessage.includes(pattern))) {
    return false;
  }

  // 재시도 가능한 오류 패턴이 포함되어 있으면 재시도 가능
  if (retryablePatterns.some((pattern) => errorMessage.includes(pattern))) {
    return true;
  }

  // HTTP 상태 코드로 판단
  if (errorStatus >= 500 && errorStatus < 600) {
    return true; // 5xx 서버 오류는 재시도 가능
  }

  // 기본값: 재시도 불가 (안전하게 처리)
  return false;
}

function classifyIngestError(error) {
  const retryable =
    typeof error?.retryable === "boolean"
      ? error.retryable
      : isRetryableError(error);
  return {
    retryable,
    code: error?.code || (retryable ? "INGEST_RETRYABLE" : "INGEST_NON_RETRYABLE"),
    httpStatus: retryable ? 503 : 422
  };
}

function toIngestExecutionError(error, classification) {
  if (error instanceof IngestExecutionError) return error;
  return new IngestExecutionError(error?.message || String(error), {
    cause: error instanceof Error ? error : undefined,
    retryable: classification.retryable,
    statusHandled: error?.statusHandled === true,
    code: classification.code
  });
}

async function runIngest(options = {}) {
  const tenant = String(options?.tenant ?? "").trim();
  const datasetId = String(options?.datasetId ?? "default").trim();
  const datasetLocale = normalizeWorkerLocale(options?.datasetLocale);
  const jobId = String(options?.jobId ?? "local").trim() || "local";
  const lifecycle = createInvocationLifecycle({
    tenant,
    datasetId,
    datasetLocale,
    jobId
  });
  const executionPromise = executeIngest(options, lifecycle);

  try {
    // 응답은 실제 실행이 정착(settle)한 뒤에만 반환한다. 18.5분 타이머는 진행 중인
    // I/O를 abort하고 cooperative assertion을 실패시키며, 분리된 실행을 남기지 않는다.
    return await executionPromise;
  } catch (rawError) {
    const caughtError =
      lifecycle.isTerminating() && lifecycle.getTerminationError()
        ? lifecycle.getTerminationError()
        : rawError;
    const classification = classifyIngestError(caughtError);
    const error = toIngestExecutionError(caughtError, classification);

    console.error("worker_execution_failed", {
      tenant: tenant || "empty",
      dataset_id: datasetId || "empty",
      error: error.message,
      error_cause: error.cause
        ? {
            message: error.cause?.message || String(error.cause),
            code: error.cause?.code,
            errno: error.cause?.errno,
            syscall: error.cause?.syscall,
            address: error.cause?.address,
            port: error.cause?.port
          }
        : null,
      stack: error.stack,
      is_retryable: classification.retryable,
      message: "Worker execution failed. Will attempt status update if possible."
    });

    if (
      tenant &&
      datasetId &&
      !error.statusHandled &&
      !classification.retryable
    ) {
      try {
        const failureResult = await updateStatusToFailedAndCleanup(
          tenant,
          datasetId,
          error.message,
          datasetLocale,
          jobId
        );
        error.statusHandled = failureResult?.handled === true;
      } catch (statusUpdateError) {
        console.error("dataset_status_update_to_failed_failed", {
          tenant,
          dataset_id: datasetId,
          error: statusUpdateError?.message || String(statusUpdateError),
          stack: statusUpdateError?.stack
        });
        captureError(statusUpdateError, {
          tenant_id: tenant || "empty",
          function_name: "updateStatusToFailedAndCleanup",
          extra: {
            dataset_id: datasetId,
            operation: "dataset_status_update_to_failed"
          }
        });
        throw new IngestExecutionError("Dataset FAILED status update failed", {
          cause:
            statusUpdateError instanceof Error
              ? statusUpdateError
              : new Error(String(statusUpdateError)),
          retryable: true,
          statusHandled: false,
          code: "DATASET_FAILED_UPDATE_FAILED"
        });
      }
    } else if (classification.retryable) {
      console.warn("retryable_error_occurred", {
        tenant: tenant || "empty",
        dataset_id: datasetId || "empty",
        error: error.message,
        message: "Retryable error occurred. Status not updated to allow an HTTP adapter retry."
      });
    }

    captureError(error, {
      tenant_id: tenant || "empty",
      function_name: "runIngest",
      extra: {
        dataset_id: datasetId,
        is_retryable: classification.retryable,
        error_code: classification.code
      }
    });
    await flushSentry();
    throw error;
  } finally {
    lifecycle.cleanup();
  }
}

module.exports = {
  runIngest,
  IngestExecutionError,
  classifyIngestError,
  isRetryableError
};
