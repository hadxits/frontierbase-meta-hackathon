/**
 * ============================================================================
 * syncGoogleSheetsDataset.js - Google Sheets dataset sync API (POST)
 * ============================================================================
 *
 * Receive tenantId and datasetId:
 * 1. Handling refresh_token:
 *    - If refresh_token is in the request body, encrypt and save it to tenant before use
 *    - If not, decrypt refresh_token from tenant document for use
 * 2. Call Google token API with refresh_token → obtain new access_token/refresh_token
 *    - If refresh_token changed, save it to tenant
 * 3. Re-read the Google Sheet of the dataset and convert to JSONL (fallback to Drive Export on Sheets API 403/404)
 * 4. Compare with the latest dataset data (last jsonl_paths)
 * 5. If changed, upload new JSONL to GCS and call runUploadDataset
 * 6. If sync_interval exists, update next_sync_at to completion time + interval (including no changes)
 *
 * Request: { tenantId, datasetId, refresh_token? }
 * Response: on success runUploadDataset result + tokenRefreshed, on noChange { synced: false, noChange: true, message, tokenRefreshed? }, on error throw
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
 * Drive Export: export spreadsheet as CSV (fallback for Sheets API 403/404).
 * Can be called with drive.file or spreadsheets.readonly scope. Exports only the first sheet.
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
 * Parse CSV text into array of rows (same logic as client parseCsvToRows).
 * Cell values are strings with quotes/commas handled. Return format matches Sheets API values: string[][]
 * Properly handle line breaks inside quotes (character-by-character scan).
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
 * Fetch only first sheet data via Drive Export (fallback for Sheets API 403/404).
 * Return: { values: string[][] } — pass directly to sheetValuesToRows / getSheetDimensions.
 */
async function fetchFirstSheetViaDriveExport(spreadsheetId, accessToken) {
  const csvText = await driveExportAsCsv(spreadsheetId, accessToken);
  const values = parseCsvToRows(csvText);
  return { values };
}

/**
 * Calculate newRows and sheetDimensions via Drive Export fallback (common for meta/values 403/404).
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
 * Convert sheet values to JSONL row array (client rawRowsToJsonlBlob + contentBasedRowId rules)
 * - First row = header, empty headers replaced by index
 * - row_id = content-based hash (tenantId + datasetId + row content) → 32-char hex (same as client)
 * - text = lines of "key: value"
 * - Common JSONL contract generates only row_id/text/version
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
    // Same as frontend: create cells only up to actual length of arr (not header length)
    const cells = arr.map((cell) => (cell != null && cell !== "" ? String(cell) : ""));
    if (!cells.some((cell) => cell.trim().length > 0)) continue;
    // rowData is index-based (same as frontend)
    const rowData = Object.fromEntries(cells.map((v, i) => [String(i), v]));
    const rowId = generateContentBasedRowId(rowData, {
      tenantId: tenantId || "",
      datasetId: datasetId || ""
    });
    // Same as frontend: use all headers, fill missing cells[i] with empty string
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

    // Compare with existing JSONL
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
      // If oldRows is missing (first sync)
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

    // Compare row changes
    const hasChanges = !rowsEqual(newRows, oldRows);
    const rowCountDiff = newRows.length - oldRows.length;

    // Detailed change analysis (same as uploadDataset: compare by row_id)
    // rowId is based on column values, so same rowId means same content, different rowId means different content
    // Therefore, changed (same rowId but different content) cannot occur
    let diffDetails = null;
    if (hasChanges && oldRows.length > 0 && newRows.length > 0) {
      const addedRows = [];
      const deletedRows = [];

      // Same as uploadDataset: create Map by row_id
      const newRowMap = new Map(newRows.map((r) => [r.rowId, r]));
      const oldRowMap = new Map(oldRows.map((r) => [r.rowId, r]));

      // Newly added rows (same logic as uploadDataset)
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

      // Deleted rows (same logic as uploadDataset)
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

      // Same calculation method as uploadDataset
      // rowId is based on column values, so same rowId means same content, different rowId means different content
      // Therefore, changed (same rowId but different content) cannot occur
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
      // No changes - query pending_tasks_count (same method as uploadDataset)
      let pending_tasks_count = 0;
      try {
        const n = await getWorkerPipelineCount(project_id);
        if (n !== null) pending_tasks_count = n;
      } catch {
        // If query fails, keep 0
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
      // _onRequest.js handles response automatically, so just return value
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

    // If changed, generate and save JSONL
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

      // Query pending_tasks_count (same method as uploadDataset)
      let pending_tasks_count = result?.pending_tasks_count || 0;
      try {
        const n = await getWorkerPipelineCount(project_id);
        if (n !== null) pending_tasks_count = n;
      } catch {
        // If query fails, keep runUploadDataset result
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
      // _onRequest.js handles response automatically, so just return value
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
      refresh_token: { type: PropertyType.STRING } // Google OAuth refresh_token for google_sheets (encrypt and save to tenant, for manual/automatic sync)
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