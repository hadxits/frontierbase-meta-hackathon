/**
 * ============================================================================
 * syncGoogleSheetsDataset.js - 구글 시트 dataset 동기화 API (POST)
 * ============================================================================
 *
 * tenantId, datasetId를 받아:
 * 1. refresh_token 처리:
 *    - 요청 body에 refresh_token이 있으면 암호화하여 tenant에 저장 후 사용
 *    - 없으면 tenant 문서의 refresh_token을 복호화하여 사용
 * 2. refresh_token으로 Google token API 호출 → 새 access_token/refresh_token 획득
 *    - refresh_token이 바뀌었으면 tenant에 저장
 * 3. 해당 dataset의 구글 시트를 다시 읽어 JSONL로 변환 (Sheets API 403/404 시 Drive Export 폴백)
 * 4. dataset의 최근 데이터(마지막 jsonl_paths)와 비교
 * 5. 변경이 있으면 새 JSONL을 GCS에 올리고 runUploadDataset 호출
 * 6. sync_interval 이 있으면 완료 시점 + interval 로 next_sync_at 갱신 (변경 없음 포함)
 *
 * 요청: { tenantId, datasetId, refresh_token? }
 * 응답: 성공 시 runUploadDataset 결과 + tokenRefreshed, noChange 시 { synced: false, noChange: true, message, tokenRefreshed? }, 에러 시 throw
 * ============================================================================
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const environment = require("@/env");
const { logInfo, logWarn, logOperationalWarn, logAndCaptureError, isOperationalError, shouldCaptureError } = require("@/utils/logger");
const { runUploadDataset } = require("@/endpoints/ai/uploadDataset");
const { store, storage } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const SourceType = require("@/const/SourceType");
const { loadAndValidateTenant } = require("@/utils/tenant");
const { decryptAsString, encrypt } = require("@/utils/crypt");
const { generateContentBasedRowId } = require("@/utils/contentBasedRowId");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { parseJsonlToRows, hasJsonlParseIssues, rowsEqual } = require("@/utils/jsonl");
const { getWorkerPipelineCount } = require("@/utils/cloudTasks");
const { AppConfig } = require("@/const/AppConfig");
const { writeNextSyncAtFromInterval } = require("@/utils/googleSheetsAutoSync");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_API_BASE = "https://sheets.googleapis.com/v4";
const GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const CANONICAL_MAX_TEXT_CHARS = 2048;

/**
 * Drive Export: 스프레드시트를 CSV로 내보내기 (Sheets API 403/404 폴백용).
 * drive.file 또는 spreadsheets.readonly 스코프로 호출 가능. 첫 시트만 내보냄.
 */
async function driveExportAsCsv(fileId, accessToken) {
  const id = String(fileId ?? "").trim();
  if (!id) throw new Error("Drive export failed: empty file id");
  const url = `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(id)}/export?mimeType=text/csv`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const body = await res.text();
    let msg = res.statusText;
    try {
      const errBody = JSON.parse(body);
      if (errBody?.error?.message) msg = errBody.error.message;
    } catch (_) {}
    throw new Error(`Drive export failed: ${res.status} ${msg}`);
  }
  return res.text();
}

/**
 * CSV 텍스트를 행 배열로 파싱 (클라이언트 parseCsvToRows와 동일한 로직).
 * 셀 값은 문자열, 따옴표/쉼표 처리. 반환 형태는 Sheets API values와 동일: string[][]
 * 따옴표 안의 줄바꿈도 올바르게 처리 (문자 단위 순회).
 */
function parseCsvToRows(csvText) {
  if (!csvText || typeof csvText !== "string") return [];
  const rows = [];
  let i = 0;
  const len = csvText.length;
  while (i < len) {
    const row = [];
    let field = "";
    let pushed = false;
    while (i < len) {
      const ch = csvText[i];
      if (ch === '"') {
        i += 1;
        while (i < len) {
          const c = csvText[i];
          if (c === '"') {
            i += 1;
            if (csvText[i] === '"') {
              field += '"';
              i += 1;
            } else {
              break;
            }
          } else {
            field += c;
            i += 1;
          }
        }
        continue;
      }
      if (ch === ",") {
        row.push(field);
        field = "";
        i += 1;
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        row.push(field);
        if (ch === "\r" && csvText[i + 1] === "\n") i += 1;
        i += 1;
        rows.push(row);
        pushed = true;
        break;
      }
      field += ch;
      i += 1;
    }
    if (!pushed && (field !== "" || row.length > 0)) {
      row.push(field);
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Drive Export로 첫 시트 데이터만 가져오기 (Sheets API 403/404 폴백).
 * 반환: { values: string[][] } — sheetValuesToRows / getSheetDimensions에 그대로 넘김.
 */
async function fetchFirstSheetViaDriveExport(spreadsheetId, accessToken) {
  const csvText = await driveExportAsCsv(spreadsheetId, accessToken);
  const values = parseCsvToRows(csvText);
  return { values };
}

/**
 * Drive Export 폴백으로 newRows·sheetDimensions 계산 (메타/values 403·404 시 공통).
 */
async function getRowsAndDimensionsViaDriveExport(spreadsheetId, accessToken, tenantId, datasetId) {
  const { values } = await fetchFirstSheetViaDriveExport(spreadsheetId, accessToken);
  return {
    newRows: sheetValuesToRows(values, tenantId, datasetId),
    sheetDimensions: getSheetDimensions(values)
  };
}

function serializeJsonlRow(row) {
  return JSON.stringify({
    row_id: row.rowId,
    text: row.text,
    version: row.version || 1
  });
}

function selectTargetSheet(sheets, sheetIdRaw) {
  const requested = String(sheetIdRaw || "").trim();
  if (!requested) return null;
  return (Array.isArray(sheets) ? sheets : []).find((sheet) => {
    const props = sheet?.properties || {};
    const byId = String(props.sheetId ?? "").trim();
    const byTitle = String(props.title ?? "").trim();
    return requested === byId || requested === byTitle;
  }) || null;
}

/**
 * 시트 values를 JSONL용 행 배열로 변환 (클라이언트 rawRowsToJsonlBlob + contentBasedRowId 규칙)
 * - 첫 행 = 헤더, 빈 헤더는 인덱스로 대체
 * - row_id = 내용 기반 해시 (tenantId + datasetId + 행 내용) → 32자 hex (클라이언트와 동일)
 * - text = "key: value" 줄 단위
 * - 공통 JSONL 계약은 row_id/text/version만 생성
 */
function sheetValuesToRows(values, tenantId, datasetId) {
  if (!Array.isArray(values) || values.length < 2) return [];

  const rawRows = values.map((row) => (Array.isArray(row) ? row : []));
  const headerRow = rawRows.length > 1 ? rawRows[0] : null;
  const dataRows = rawRows.length > 1 ? rawRows.slice(1) : rawRows;

  const colCount =
    dataRows.length > 0
      ? Math.max(...dataRows.map((r) => (Array.isArray(r) ? r : []).length))
      : 0;

  const baseHeaders = headerRow
    ? (Array.isArray(headerRow) ? headerRow : []).map((h, i) =>
      h != null && String(h).trim() !== "" ? String(h).trim() : String(i)
    )
    : [];

  const headers = Array.from(
    { length: Math.max(baseHeaders.length, colCount) },
    (_, i) => baseHeaders[i] ?? String(i)
  );

  const rows = [];
  for (const row of dataRows) {
    const arr = Array.isArray(row) ? row : [];
    // 프론트엔드와 동일: arr의 실제 길이만큼만 cells 생성 (headers 길이가 아닌)
    const cells = arr.map((cell) => (cell != null && cell !== "" ? String(cell) : ""));
    if (!cells.some((cell) => cell.trim().length > 0)) continue;
    // rowData는 인덱스 기반 (프론트엔드와 동일)
    const rowData = Object.fromEntries(cells.map((v, i) => [String(i), v]));
    const rowId = generateContentBasedRowId(rowData, {
      tenantId: tenantId || "",
      datasetId: datasetId || ""
    });
    // 프론트엔드와 동일: headers 전체를 사용하되, cells[i]가 없으면 빈 문자열
    const text = headers.map((h, i) => `${h}: ${cells[i] != null ? cells[i] : ""}`).join("\n");

    rows.push({ rowId, text, version: 1 });
  }
  return rows;
}

function getSheetDimensions(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { rows: 0, cols: 0 };
  }
  const rawRows = values.map((row) => (Array.isArray(row) ? row : []));
  const headerRow = rawRows[0] || [];
  const dataRows = rawRows.slice(1);
  const nonEmptyDataRows = dataRows.filter((row) =>
    (Array.isArray(row) ? row : []).some(
      (cell) => String(cell ?? "").trim().length > 0
    )
  );
  const cols = Math.max(
    Array.isArray(headerRow) ? headerRow.length : 0,
    ...nonEmptyDataRows.map((row) => (Array.isArray(row) ? row.length : 0))
  );
  return {
    rows: nonEmptyDataRows.length,
    cols
  };
}
/**
 * @param {{ tenantId: string, datasetId: string, refresh_token?: string, locale?: string }} params
 */
async function runSyncGoogleSheetsDataset({
  tenantId,
  datasetId,
  refresh_token: refreshTokenBody = null,
  locale: localeFromRequest = "en"
}) {
    const tenant = String(tenantId || "").trim();
    const dataset = String(datasetId || "").trim();
    const project_id = AppConfig.GCP_PROJECT_ID;
    if (!tenant || !dataset) {
      throw new ApiError({
        errorCode: "INVALID_PARAMS",
        message: getLocalizedErrorMessage(
          localeFromRequest,
          "SYNC_PARAMS_REQUIRED"
        ),
        httpStatusCode: 400,
        returnToUser: true
      });
    }
    const clientId = environment.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = environment.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new ApiError({
        errorCode: "CONFIG_ERROR",
        message: getLocalizedErrorMessage(
          localeFromRequest,
          "GOOGLE_OAUTH_NOT_CONFIGURED"
        ),
        httpStatusCode: 503,
        returnToUser: true
      });
    }

    const { tenantData } = await loadAndValidateTenant(tenant, {
      requireQdrantUrl: false,
      functionName: "syncGoogleSheetsDataset"
    });
    const locale = tenantData?.language || localeFromRequest;

    const tenantRef = store.collection(Collection.TENANTS).doc(tenant);
    const datasetRef = tenantRef.collection(Collection.DATASETS).doc(dataset);
    const datasetSnap = await datasetRef.get();
    if (!datasetSnap.exists) {
      throw new ApiError({
        errorCode: "DATASET_NOT_FOUND",
        message: getLocalizedErrorMessage(locale, "DATASET_NOT_FOUND"),
        httpStatusCode: 404,
        returnToUser: true
      });
    }

    const datasetData = datasetSnap.data();
    if (datasetData?.source_type !== SourceType.GOOGLE_SHEETS) {
      throw new ApiError({
        errorCode: "INVALID_SOURCE_TYPE",
        message: getLocalizedErrorMessage(locale, "INVALID_SOURCE_TYPE"),
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const spreadsheetId = datasetData?.spreadsheet_id;
    const sheetIdRaw = datasetData?.sheet_id;
    if (!spreadsheetId || !sheetIdRaw) {
      throw new ApiError({
        errorCode: "MISSING_SHEET_INFO",
        message: getLocalizedErrorMessage(locale, "MISSING_SHEET_INFO"),
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    let refreshTokenRaw;
    const refreshTokenFromBody =
      refreshTokenBody != null && typeof refreshTokenBody === "string"
        ? refreshTokenBody.trim()
        : "";

    if (refreshTokenFromBody.length > 0) {
      refreshTokenRaw = refreshTokenFromBody;
      try {
        await tenantRef.set(
          { google_sheets_refresh_token_encrypted: encrypt(refreshTokenRaw) },
          { merge: true }
        );
        logInfo("[syncGoogleSheetsDataset] Refresh token from request saved to tenant", {
          tenant_id: tenant,
          function_name: "syncGoogleSheetsDataset"
        });
      } catch (encErr) {
        logWarn("[syncGoogleSheetsDataset] Failed to encrypt/save refresh_token to tenant", {
          tenant_id: tenant,
          function_name: "syncGoogleSheetsDataset",
          extra: { error: encErr?.message }
        });
      }
    } else {
      const encryptedRefresh = tenantData?.google_sheets_refresh_token_encrypted;
      if (!encryptedRefresh || typeof encryptedRefresh !== "string") {
        throw new ApiError({
          errorCode: "MISSING_REFRESH_TOKEN",
          message: getLocalizedErrorMessage(locale, "MISSING_REFRESH_TOKEN"),
          httpStatusCode: 400,
          returnToUser: true
        });
      }
      try {
        refreshTokenRaw = decryptAsString(encryptedRefresh);
        if (typeof refreshTokenRaw !== "string")
          refreshTokenRaw = String(refreshTokenRaw ?? "");
      } catch (e) {
        logWarn("[syncGoogleSheetsDataset] Failed to decrypt refresh_token", {
          tenant_id: tenant,
          function_name: "syncGoogleSheetsDataset",
          extra: { error: e?.message }
        });
        throw new ApiError({
          errorCode: "DECRYPT_FAILED",
          message: getLocalizedErrorMessage(locale, "DECRYPT_FAILED"),
          httpStatusCode: 500,
          returnToUser: true
        });
      }
    }

    const tokenBody = new URLSearchParams({
      refresh_token: refreshTokenRaw,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token"
    });

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString()
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      const msg =
        tokenData?.error_description ||
        tokenData?.error ||
        "Token refresh failed.";
      const errorCode = tokenData?.error;
      const isInvalidGrant = errorCode === "invalid_grant";
      logWarn("[syncGoogleSheetsDataset] Google token refresh failed", {
        tenant_id: tenant,
        function_name: "syncGoogleSheetsDataset",
        extra: { message: msg, errorCode, isInvalidGrant }
      });
      throw new ApiError({
        errorCode: isInvalidGrant ? "GOOGLE_REFRESH_TOKEN_EXPIRED" : "GOOGLE_OAUTH_ERROR",
        message: msg,
        httpStatusCode:
          tokenRes.status >= 400 && tokenRes.status < 500 ? 400 : 502,
        returnToUser: true
      });
    }

    const newRefreshToken = tokenData.refresh_token || null;
    let tokenRefreshed = false;
    if (newRefreshToken && newRefreshToken !== refreshTokenRaw) {
      try {
        await tenantRef.set(
          { google_sheets_refresh_token_encrypted: encrypt(newRefreshToken) },
          { merge: true }
        );
        tokenRefreshed = true;
        logInfo("[syncGoogleSheetsDataset] Tenant refresh_token updated", {
          tenant_id: tenant,
          function_name: "syncGoogleSheetsDataset"
        });
      } catch (encErr) {
        logWarn("[syncGoogleSheetsDataset] Failed to save new refresh_token", {
          tenant_id: tenant,
          function_name: "syncGoogleSheetsDataset",
          extra: { error: encErr?.message }
        });
      }
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new ApiError({
        errorCode: "GOOGLE_OAUTH_ERROR",
        message: getLocalizedErrorMessage(
          locale,
          "GOOGLE_OAUTH_NO_ACCESS_TOKEN"
        ),
        httpStatusCode: 502,
        returnToUser: true
      });
    }

    const authHeader = { Authorization: `Bearer ${accessToken}` };

    let rangeForValues;
    const spreadsheetRes = await fetch(
      `${GOOGLE_SHEETS_API_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
      { headers: authHeader }
    );

    if (spreadsheetRes.status === 403 || spreadsheetRes.status === 404) {
      await spreadsheetRes.text().catch(() => "");
      rangeForValues = "Sheet1";
    } else {
      if (!spreadsheetRes.ok) {
        const errBody = await spreadsheetRes.json().catch(() => ({}));
        const msg = errBody?.error?.message || spreadsheetRes.statusText;
        throw new ApiError({
          errorCode: "GOOGLE_SHEETS_ERROR",
          message:
            msg ||
            getLocalizedErrorMessage(locale, "GOOGLE_SHEETS_SPREADSHEET_FAILED"),
          httpStatusCode:
            spreadsheetRes.status >= 400 && spreadsheetRes.status < 500
              ? 400
              : 502,
          returnToUser: true
        });
      }
      const spreadsheetJson = await spreadsheetRes.json();
      const sheets = spreadsheetJson.sheets || [];
      if (!Array.isArray(sheets) || sheets.length === 0) {
        throw new ApiError({
          errorCode: "GOOGLE_SHEETS_ERROR",
          message: getLocalizedErrorMessage(locale, "GOOGLE_SHEETS_NO_SHEETS"),
          httpStatusCode: 400,
          returnToUser: true
        });
      }
      const targetSheet = selectTargetSheet(sheets, sheetIdRaw);
      if (!targetSheet?.properties?.title) {
        throw new ApiError({
          errorCode: "MISSING_SHEET_INFO",
          message: getLocalizedErrorMessage(locale, "MISSING_SHEET_INFO"),
          httpStatusCode: 400,
          returnToUser: true
        });
      }
      rangeForValues = targetSheet.properties.title;
    }

    const range = encodeURIComponent(rangeForValues);
    const valuesRes = await fetch(
      `${GOOGLE_SHEETS_API_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`,
      { headers: authHeader }
    );

    let newRows;
    let sheetDimensions;

    if (valuesRes.status === 403 || valuesRes.status === 404) {
      await valuesRes.text().catch(() => "");
      logInfo("[syncGoogleSheetsDataset] Sheets API values 403/404, using Drive Export fallback", {
        tenant_id: tenant,
        function_name: "syncGoogleSheetsDataset",
        extra: { spreadsheetId, status: valuesRes.status }
      });
      try {
        const fallback = await getRowsAndDimensionsViaDriveExport(
          spreadsheetId,
          accessToken,
          tenant,
          dataset
        );
        newRows = fallback.newRows;
        sheetDimensions = fallback.sheetDimensions;
      } catch (driveErr) {
        throw new ApiError({
          errorCode: "GOOGLE_SHEETS_ERROR",
          message:
            driveErr?.message ||
            getLocalizedErrorMessage(locale, "GOOGLE_SHEETS_VALUES_FAILED"),
          httpStatusCode: 502,
          returnToUser: true
        });
      }
    } else {
      if (!valuesRes.ok) {
        const errBody = await valuesRes.json().catch(() => ({}));
        const msg = errBody?.error?.message || valuesRes.statusText;
        throw new ApiError({
          errorCode: "GOOGLE_SHEETS_ERROR",
          message:
            msg ||
            getLocalizedErrorMessage(locale, "GOOGLE_SHEETS_VALUES_FAILED"),
          httpStatusCode:
            valuesRes.status >= 400 && valuesRes.status < 500 ? 400 : 502,
          returnToUser: true
        });
      }
      const valuesJson = await valuesRes.json();
      const values = valuesJson.values || [];
      newRows = sheetValuesToRows(values, tenant, dataset);
      sheetDimensions = getSheetDimensions(values);

      logInfo(
        `[syncGoogleSheetsDataset] New rows parsed from Google Sheets: ${newRows.length} rows (sheet: ${sheetDimensions.rows} rows, ${sheetDimensions.cols} cols)`,
        {
          tenant_id: tenant,
          function_name: "syncGoogleSheetsDataset",
          extra: {
            dataset_id: dataset,
            new_rows_count: newRows.length,
            sheet_rows: sheetDimensions.rows,
            sheet_cols: sheetDimensions.cols
          }
        }
      );
    }

    let rowLimit = tenantData?.quota?.row_limit_per_dataset ?? 100;
    rowLimit += 2;
    if (newRows.length > rowLimit) {
      throw new ApiError({
        errorCode: "TOO_MANY_ROWS",
        message: getLocalizedErrorMessage(locale, "TOO_MANY_ROWS_MAX").replace(
          /\{max\}/g,
          String(rowLimit)
        ),
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    for (const r of newRows) {
      if (r.text.length > CANONICAL_MAX_TEXT_CHARS) {
        throw new ApiError({
          errorCode: "TEXT_TOO_LONG",
          message: getLocalizedErrorMessage(
            locale,
            "TEXT_TOO_LONG_MAX"
          ).replace(/\{max\}/g, String(CANONICAL_MAX_TEXT_CHARS)),
          httpStatusCode: 400,
          returnToUser: true
        });
      }
    }

    // 기존 JSONL과 비교
    let oldRows = [];
    const jsonlPaths = datasetData?.jsonl_paths || [];
    const lastPath =
      Array.isArray(jsonlPaths) && jsonlPaths.length > 0
        ? jsonlPaths[jsonlPaths.length - 1]
        : null;
    const actualOldPath = lastPath?.gcs_path || null;

    if (actualOldPath) {
      const gsMatch = actualOldPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
      if (gsMatch) {
        try {
          const [, oldBucket, oldFilePath] = gsMatch;
          const oldFile = storage.bucket(oldBucket).file(oldFilePath);
          const [exists] = await oldFile.exists();
          if (exists) {
            const [buf] = await oldFile.download();
            const parsedOldRows = parseJsonlToRows(buf.toString("utf-8"));
            oldRows = parsedOldRows.rows;

            logInfo(
              `[syncGoogleSheetsDataset] Old rows loaded from JSONL: ${oldRows.length} rows${hasJsonlParseIssues(parsedOldRows.issues) ? " (has parse issues)" : ""}`,
              {
                tenant_id: tenant,
                function_name: "syncGoogleSheetsDataset",
                extra: {
                  dataset_id: dataset,
                  old_jsonl_path: actualOldPath,
                  old_rows_count: oldRows.length,
                  has_parse_issues: hasJsonlParseIssues(parsedOldRows.issues)
                }
              }
            );

            if (hasJsonlParseIssues(parsedOldRows.issues)) {
              logWarn(
                "[syncGoogleSheetsDataset] Old JSONL contains invalid canonical rows",
                {
                  tenant_id: tenant,
                  function_name: "syncGoogleSheetsDataset",
                  extra: {
                    path: actualOldPath,
                    issues: parsedOldRows.issues
                  }
                }
              );
            }
          }
        } catch (e) {
          logWarn("[syncGoogleSheetsDataset] Failed to load old JSONL", {
            tenant_id: tenant,
            function_name: "syncGoogleSheetsDataset",
            extra: { path: actualOldPath, error: e?.message }
          });
        }
      }
    } else {
      // oldRows가 없는 경우 (첫 동기화)
      logInfo(
        `[syncGoogleSheetsDataset] No old JSONL found, first sync: ${newRows.length} rows`,
        {
          tenant_id: tenant,
          function_name: "syncGoogleSheetsDataset",
          extra: {
            dataset_id: dataset,
            new_rows_count: newRows.length
          }
        }
      );
    }

    // Row 변경 비교
    const hasChanges = !rowsEqual(newRows, oldRows);
    const rowCountDiff = newRows.length - oldRows.length;

    // 변경 상세 분석 (uploadDataset과 동일: row_id 기준으로 비교)
    // rowId는 컬럼 값 기반이므로, rowId가 같으면 내용도 같고, rowId가 다르면 내용도 다름
    // 따라서 changed (같은 rowId지만 내용이 변경된 경우)는 발생할 수 없음
    let diffDetails = null;
    if (hasChanges && oldRows.length > 0 && newRows.length > 0) {
      const addedRows = [];
      const deletedRows = [];

      // uploadDataset과 동일: row_id 기준으로 Map 생성
      const newRowMap = new Map(newRows.map((r) => [r.rowId, r]));
      const oldRowMap = new Map(oldRows.map((r) => [r.rowId, r]));

      // 새로 추가된 row (uploadDataset과 동일 로직)
      newRows.forEach((row) => {
        if (!oldRowMap.has(row.rowId)) {
          if (addedRows.length < 10) {
            addedRows.push({
              row_id: row.rowId,
              text_preview: row.text.substring(0, 100) + (row.text.length > 100 ? "..." : ""),
              text_length: row.text.length
            });
          }
        }
      });

      // 삭제된 row (uploadDataset과 동일 로직)
      oldRows.forEach((row) => {
        if (!newRowMap.has(row.rowId)) {
          if (deletedRows.length < 10) {
            deletedRows.push({
              row_id: row.rowId,
              text_preview: row.text.substring(0, 100) + (row.text.length > 100 ? "..." : ""),
              text_length: row.text.length
            });
          }
        }
      });

      // uploadDataset과 동일한 계산 방식
      // rowId는 컬럼 값 기반이므로, rowId가 같으면 내용도 같고, rowId가 다르면 내용도 다름
      // 따라서 changed (같은 rowId지만 내용이 변경된 경우)는 발생할 수 없음
      const totalAdded = newRows.filter((r) => !oldRowMap.has(r.rowId)).length;
      const totalDeleted = oldRows.filter((r) => !newRowMap.has(r.rowId)).length;

      diffDetails = {
        added_count: totalAdded,
        deleted_count: totalDeleted,
        added_rows: addedRows,
        deleted_rows: deletedRows
      };
    }

    logInfo(
      `[syncGoogleSheetsDataset] Row comparison completed: old=${oldRows.length}, new=${newRows.length}, diff=${rowCountDiff > 0 ? "+" : ""}${rowCountDiff}, hasChanges=${hasChanges}${oldRows.length === 0 ? " (first sync)" : ""}${diffDetails ? `, added=${diffDetails.added_count}, deleted=${diffDetails.deleted_count}` : ""}`,
      {
        tenant_id: tenant,
        function_name: "syncGoogleSheetsDataset",
        extra: {
          dataset_id: dataset,
          old_rows_count: oldRows.length,
          new_rows_count: newRows.length,
          row_count_diff: rowCountDiff,
          has_changes: hasChanges,
          is_first_sync: oldRows.length === 0,
          diff_details: diffDetails
        }
      }
    );

    if (!hasChanges) {
      // 변경 없음 - pending_tasks_count 조회 (uploadDataset과 동일한 방식)
      let pending_tasks_count = 0;
      try {
        const n = await getWorkerPipelineCount(project_id);
        if (n !== null) pending_tasks_count = n;
      } catch {
        // 조회 실패 시 0 유지
      }

      logInfo(
        `[syncGoogleSheetsDataset] No changes detected, skipping sync: old=${oldRows.length}, new=${newRows.length}, pending=${pending_tasks_count}${tokenRefreshed ? " (token refreshed)" : ""}`,
        {
          tenant_id: tenant,
          function_name: "syncGoogleSheetsDataset",
          extra: {
            dataset_id: dataset,
            old_rows_count: oldRows.length,
            new_rows_count: newRows.length,
            pending_tasks_count: pending_tasks_count,
            tokenRefreshed: !!tokenRefreshed
          }
        }
      );
      await writeNextSyncAtFromInterval(datasetRef, datasetData);
      // _onRequest.js가 자동으로 응답을 처리하므로 값만 반환
      return {
        synced: false,
        noChange: true,
        message: getLocalizedErrorMessage(locale, "SYNC_NO_CHANGES"),
        pending_tasks_count,
        tokenRefreshed: tokenRefreshed || undefined
      };
    }
    if (newRows.length === 0 && sheetDimensions.cols < 1) {
      throw new ApiError({
        errorCode: "NO_DATA_FOUND",
        message: getLocalizedErrorMessage(locale, "NO_DATA_FOUND"),
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    // 변경이 있으면 JSONL 생성 및 저장
    const bucketName =
      process.env.GCS_BUCKET || "frontierbase-console.firebasestorage.app";

    const jsonlContent = newRows
      .map((row) => serializeJsonlRow(row))
      .join("\n");

    const syncFileName = `datasets/${tenant}/${dataset}/${Date.now()}_sync.jsonl`;
    const syncFile = storage.bucket(bucketName).file(syncFileName);
    await syncFile.save(jsonlContent, {
      metadata: {
        contentType: "application/x-ndjson",
        metadata: { tenant, dataset_id: dataset, type: "sync" }
      }
    });
    const newFilePath = `gs://${bucketName}/${syncFileName}`;

    logInfo(
      `[syncGoogleSheetsDataset] Changes detected, sync JSONL saved${diffDetails ? `: added=${diffDetails.added_count}, deleted=${diffDetails.deleted_count}` : ""}, rows=${newRows.length}${tokenRefreshed ? " (token refreshed)" : ""}`,
      {
        tenant_id: tenant,
        function_name: "syncGoogleSheetsDataset",
        extra: {
          dataset_id: dataset,
          new_file_path: newFilePath,
          old_rows_count: oldRows.length,
          new_rows_count: newRows.length,
          row_count_diff: rowCountDiff,
          sheet_rows: sheetDimensions.rows,
          sheet_cols: sheetDimensions.cols,
          diff_details: diffDetails,
          tokenRefreshed: !!tokenRefreshed
        }
      }
    );

    try {
      const result = await runUploadDataset({
        tenant,
        dataset_id: dataset,
        source_type: SourceType.GOOGLE_SHEETS,
        new_file_path: newFilePath,
        name: datasetData?.name ?? "",
        spreadsheetId: datasetData?.spreadsheet_id ?? "",
        sheetId: datasetData?.sheet_id ?? "",
        spreadsheetName: datasetData?.spreadsheet_name ?? "",
        rows: sheetDimensions.rows,
        cols: sheetDimensions.cols > 0 ? sheetDimensions.cols : 1
      });

      // pending_tasks_count 조회 (uploadDataset과 동일한 방식)
      let pending_tasks_count = result?.pending_tasks_count || 0;
      try {
        const n = await getWorkerPipelineCount(project_id);
        if (n !== null) pending_tasks_count = n;
      } catch {
        // 조회 실패 시 runUploadDataset 결과값 유지
      }

      logInfo(
        `[syncGoogleSheetsDataset] Sync completed successfully: old=${oldRows.length}, new=${newRows.length}, processed=${result?.record_count || 0}, pending=${pending_tasks_count}${tokenRefreshed ? " (token refreshed)" : ""}`,
        {
          tenant_id: tenant,
          function_name: "syncGoogleSheetsDataset",
          extra: {
            dataset_id: dataset,
            old_rows_count: oldRows.length,
            new_rows_count: newRows.length,
            record_count: result?.record_count || 0,
            pending_tasks_count: pending_tasks_count,
            tokenRefreshed: !!tokenRefreshed
          }
        }
      );

      await writeNextSyncAtFromInterval(datasetRef, datasetData);
      // _onRequest.js가 자동으로 응답을 처리하므로 값만 반환
      return {
        ...result,
        pending_tasks_count,
        tokenRefreshed: tokenRefreshed || undefined
      };
    } catch (invokeErr) {
      if (isOperationalError(invokeErr)) {
        logOperationalWarn(
          `[syncGoogleSheetsDataset] ${invokeErr.errorCode || "runUploadDataset error"}`,
          {
            tenant_id: tenant,
            function_name: "syncGoogleSheetsDataset",
            extra: {
              dataset_id: dataset,
              message: invokeErr.message
            }
          }
        );
      } else if (shouldCaptureError(invokeErr)) {
        logAndCaptureError(
          invokeErr instanceof Error ? invokeErr : new Error(String(invokeErr)),
          "[syncGoogleSheetsDataset] runUploadDataset error",
          {
            tenant_id: tenant,
            function_name: "syncGoogleSheetsDataset",
            extra: { dataset_id: dataset }
          }
        );
      }
      throw invokeErr;
    }
}

const syncGoogleSheetsDataset = _onRequest({
  opts: {
    memory: "512MiB",
    timeoutSeconds: 120,
    maxInstances: 8,
    concurrency: 2
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenantId: { type: PropertyType.STRING },
      datasetId: { type: PropertyType.STRING },
      refresh_token: { type: PropertyType.STRING } // google_sheets 시 Google OAuth refresh_token (암호화하여 tenant에 저장, 수동/자동 동기화용)
    },
    required: ["tenantId", "datasetId"],
    additionalProperties: false
  },
  handler: async (req) => {
    const body = req.body || {};
    return runSyncGoogleSheetsDataset({
      tenantId: body.tenantId,
      datasetId: body.datasetId,
      refresh_token: body.refresh_token,
      locale: body.locale || "en"
    });
  }
});

module.exports = syncGoogleSheetsDataset;
module.exports.runSyncGoogleSheetsDataset = runSyncGoogleSheetsDataset;