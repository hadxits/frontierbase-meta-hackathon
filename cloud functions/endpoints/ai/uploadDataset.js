/**
 * ============================================================================
 * uploadDataset.js - Dataset upload and indexing endpoint
 * ============================================================================
 *
 * New file (new_file_path) is always JSONL format. Firestore stores source_type as-is (e.g. excel, csv)
 * It triggers worker.js to save embeddings to Qdrant vector DB.
 * Endpoint for that process.
 *
 * Key features:
 * 1. File parsing: parse only JSONL at new_file_path (GCS) (row_id, text, version)
 * 2. Validation and checks:
 *    - Token limit check (before worker runs)
 *    - dataset_limit check (on new dataset creation, tenant quota based)
 *    - MAX_ROWS check (tenant quota based)
 *    - CANONICAL_MAX_TEXT_CHARS check (canonical limit regardless of source/language)
 * 3. Incremental update: compare with existing row_id to classify additions/updates
 * 4. Trigger worker.js: Cloud Tasks → workerTask.js → Cloud Run Job execution
 *
 * Process flow:
 * 1. Validate parameters
 * 2. Verify tenant and load data
 * 3. Determine Dataset
 * 4. Load previous JSONL file (from dataset's last jsonl_paths)
 * 5. Download new file (JSONL)
 * 6. Parse JSONL (newRows)
 * 7. Check row count and text length (MAX_ROWS, CANONICAL_MAX_TEXT_CHARS)
 * 8. Perform diff (compare oldRows and newRows to classify toAdd/toArchive)
 * 8b. If previous JSONL exists and toAdd/toArchive are both 0, no changes → skip GCS/worker (same message as sync)
 * 9. Convert JSONL and save to GCS (two files: full + worker)
 *    - fullJsonlPath: all newRows (for deletion detection, next comparison)
 *    - workerJsonlPath: only toAdd (for actual work)
 * 10. Token limit check (fail immediately without dataset doc update if exceeded)
 * 11. Update Dataset doc basic info (name, source_type, source_ref, rows, cols, etc.; jsonl_paths saved after worker.js completes)
 * 12. Enqueue task to Cloud Tasks (workerTask.js runs Cloud Run Job)
 *
 * Notes:
 * - source_type is stored in Firestore as received from client (excel, csv, google_sheets, etc.)
 * - If source_type is google_sheets and refresh_token is provided, encrypt with AES and save to tenant doc (for manual/automatic sync).
 * - If source_type is google_sheets, source_ref is always saved as new_file_path (gs:// JSONL). File download (getSourceDownloadUrl dataset_id) prioritizes last jsonl_paths snapshot. Spreadsheet identified by spreadsheet_id/sheet_id.
 * - worker.js includes canonical JSONL validation and delete-only/no-op guards for backend safety.
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
// Functions related to Cloud Tasks
const {
  enqueueWorkerTask,
  getWorkerPipelineCount
} = require("@/utils/cloudTasks");

// Multilingual support functions
const {
  getLocalizedErrorMessage,
} = require("@/utils/localization");

// Common functions related to tenants
const { loadAndValidateTenant } = require("@/utils/tenant");

// Common functions related to messages
const { getDatasetSuccessMessage } = require("@/utils/messages");
const {
  estimateIngestCompletionSeconds
} = require("@/utils/estimateIngestEta");

// Dataset status constants
const DatasetStatus = require("@/const/DatasetStatus");

// Data source type constants
const SourceType = require("@/const/SourceType");

// Token and dataset limit check utilities
const checkTokenLimit = require("@/utils/checkTokenLimit");
const checkDatasetLimit = require("@/utils/checkDatasetLimit");

// Qdrant collection name (actual vector processing done in indexing worker)
const { getQdrantCollectionName } = require("@/utils/qdrant");

// Common configuration constants
const { AppConfig } = require("@/const/AppConfig");

// Encrypt refresh_token (for google_sheets, save to tenant doc)
const { encrypt } = require("@/utils/crypt");

const { parseJsonlToRows, hasJsonlParseIssues } = require("@/utils/jsonl");
const { buildDatasetProfile } = require("@/utils/datasetProfile");

const crypto = require("crypto");

const CANONICAL_MAX_TEXT_CHARS = 2048;

// embed_value is calculated and saved as average embedding per dataset in worker.js (not used in uploadDataset)

// ============================================================================
// Utility functions
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
 * Handle duplicate row_id
 * @param {Array} rows - Array of rows
 * @returns {Object} - { rows, duplicates }
 */
function handleDuplicateRowIds(rows) {
  const rowIdMap = new Map(); // rowId -> [rows]
  const duplicates = [];

  // Group by row_id
  for (const row of rows) {
    if (!rowIdMap.has(row.rowId)) {
      rowIdMap.set(row.rowId, []);
    }
    rowIdMap.get(row.rowId).push(row);
  }

  // Handle duplicates
  for (const [rowId, duplicateRows] of rowIdMap) {
    if (duplicateRows.length > 1) {
      // Duplicate found: add unique number from the second occurrence
      // Use 32-character hash even when handling duplicates (32 bytes, within Firestore limits)
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
// Helper function to update Dataset status
// ============================================================================

/**
 * Helper function to record failure status in Dataset document
 * Versioning is done only per row (remove versions collection per dataset)
 * @param {string} tenant - Tenant ID
 * @param {string} datasetId - dataset ID
 * @param {string} source_type - File type
 * @param {string} storage_path - GCS path
 * @param {string} embed_model - Embedding model
 * @param {string} description - Description
 * @param {string} qdrant_url - Qdrant URL
 * @param {string} errorMessage - Error message
 * @param {string} [name] - Dataset name
 * @param {string} [source_ref] - Source reference (e.g., file path)
 * @param {string|null} [expectedProcessingJobId] - Job ownership ID to mark failure for
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
    error: errorMessage, // Save error message
    embed_model: embed_model,
    description: description || "",
    qdrant_url: qdrant_url,
    qdrant_collection, // Qdrant collection name by tenant (for search/debugging)
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
    memory: "2GiB", // Memory quota (2GiB)
    cpu: 2, // Number of vCPUs (2nd gen: 1 or 2, default depends on memory)
    maxInstances: 10,
    concurrency: 2,
    timeoutSeconds: 180 // 1 minute (should not take long here even if task takes longer)
  },
  requireCredential: true,
  stream: false,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      dataset_id: { type: PropertyType.STRING }, // Dataset ID (specified directly)
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
      new_file_path: { type: PropertyType.STRING }, // New file path (JSONL) (e.g., gs://bucket/path/file.jsonl)
      description: { type: PropertyType.STRING },
      source_ref: { type: PropertyType.STRING }, // excel/csv etc.: path or URL. For google_sheets: ignored and new_file_path(gs://) is saved
      refresh_token: { type: PropertyType.STRING }, // Google OAuth refresh_token for google_sheets (encrypt and save to tenant, for manual/automatic sync)
      spreadsheetId: { type: PropertyType.STRING }, // Spreadsheet ID for google_sheets (saved in dataset)
      sheetId: { type: PropertyType.STRING }, // Sheet ID for google_sheets (saved in dataset)
      spreadsheetName: { type: PropertyType.STRING }, // Spreadsheet name for google_sheets (saved in dataset)
      rows: { type: PropertyType.NUMBER }, // Row count (required from client, based on actual data)
      cols: { type: PropertyType.NUMBER } // Column count (required from client, based on original source)
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
 * Core upload logic (used commonly by HTTP handler and syncGoogleSheetsDataset etc.)
 * @param {Object} params - Same as uploadDataset request (tenant, dataset_id, new_file_path, source_type, name, source_ref, refresh_token, spreadsheetId, sheetId, spreadsheetName, etc.). For google_sheets, source_ref is ignored and new_file_path is saved.
 * @returns {Promise<{ success: boolean, dataset_id: string, record_count: number, message: string, pending_tasks_count: number, full_jsonl_path?: string, worker_jsonl_path?: string, synced?: boolean, noChange?: boolean }>}
 */
async function runUploadDataset(params) {
  const {
    tenant,
    dataset_id, // Dataset ID (specified directly)
    name,
    source_type,
    new_file_path, // New file path (JSONL)
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

  // Use common constants
  const embed_model = AppConfig.DEFAULT_EMBED_MODEL; // "text-embedding-3-small"
  const project_id = AppConfig.GCP_PROJECT_ID; // "frontierbase-console"

  // Determine vector dimension (critical value, depends on embed_model)
  // Default: text-embedding-3-small (1536 dimensions)
  const getVectorSizeFromModel = (model) => {
    if (model.includes("text-embedding-3-small")) return 1536;
    if (model.includes("text-embedding-3-large")) return 3072;
    // Default: small (1536 dimensions)
    return 1536;
  };
  const vector_size = getVectorSizeFromModel(embed_model);

  // ========================================================================
  // 0. Parameter validation
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
  // 1. Validate tenant and load data
  // ========================================================================
  const { tenantData, locale, qdrant_url } = await loadAndValidateTenant(
    tenant,
    {
      locale: "en", // Temporary locale before tenant lookup
      functionName: "uploadDataset"
    }
  );

  // Get row_limit_per_dataset from tenant quota (default: 100)
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

  // Text length limit is fixed as a canonical contract independent of source/tenant language.
  const MAX_TEXT_CHARS = CANONICAL_MAX_TEXT_CHARS;

  // ========================================================================
  // 2. Determine Dataset
  // ========================================================================
  // Use dataset_id as is
  // Versioning is done only per row (remove versions collection per dataset)
  const finalDatasetId = dataset_id;
  let activeProcessingJobId = null;

  // ========================================================================
  // Helper: set Dataset status to failed and throw error on failure
  // ========================================================================
  /**
   * Helper function to set Dataset status to failed and throw ApiError
   * @param {string} errorCode - Error code (e.g., "NO_DATA_FOUND")
   * @param {Object} [options] - Options
   * @param {number} [options.httpStatusCode=400] - HTTP status code
   * @param {Error} [options.originalError] - Original error (throw this error if present)
   * @param {Object} [options.logDetails] - Additional logging info (included in logOperationalWarn)
   * @param {boolean} [options.returnToUser=true] - If true, send error code/message to client
   * @param {Object} [options.details] - Detailed info to send to client (included in response body if returnToUser)
   * @param {string} [options.localizedErrorKey] - Multilingual message key (used instead of errorCode if specified, for same message as streamChatRag)
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
    // If you force quota check without knowing if document exists, re-upload of existing dataset may be falsely detected.
    skipDatasetLimitCheck = true;
    logWarn("[uploadDataset] Failed to load dataset document", {
      tenant_id: tenant,
      function_name: "uploadDataset",
      extra: { dataset_id: finalDatasetId, error: datasetErr?.message }
    });
  }

  // ========================================================================
  // 2b. Check dataset count limit (only for new datasets)
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
  // 3. Load previous JSONL file (get last jsonl_paths from dataset)
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

  // Load old_jsonl_path (if obtained from dataset)
  if (actualOldJsonlPath) {
    try {
      const oldGsPathMatch = actualOldJsonlPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
      if (oldGsPathMatch) {
        const [oldBucket, oldFilePath] = [oldGsPathMatch[1], oldGsPathMatch[2]];
        const oldFile = storage.bucket(oldBucket).file(oldFilePath);

        // Check if previous JSONL file exists
        const [oldExists] = await oldFile.exists();
        if (oldExists) {
          // Download and parse previous JSONL file
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
      // Continue even if loading old file fails (process all)
    }
  }

  // ========================================================================
  // 4. Download new file (JSONL)
  // ========================================================================
  const newGsPathMatch = new_file_path.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!newGsPathMatch) {
    await failDatasetAndThrow("INVALID_STORAGE_PATH");
  }

  const [bucket, filePath] = [newGsPathMatch[1], newGsPathMatch[2]];
  const file = storage.bucket(bucket).file(filePath);

  // Check if file exists
  const [exists] = await file.exists();
  if (!exists) {
    await failDatasetAndThrow("FILE_NOT_FOUND", {
      httpStatusCode: 404,
      logDetails: { file_path: new_file_path }
    });
  }

  // Download file
  const [fileBuffer] = await file.download();
  logInfo("[uploadDataset] New file downloaded", {
    tenant_id: tenant,
    function_name: "uploadDataset",
    extra: { file_path: new_file_path, file_size: fileBuffer.length }
  });

  // ========================================================================
  // 5. Parse JSONL (new file is always JSONL)
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
  // 6. Check row count and text length (tenant quota and canonical limits)
  // ========================================================================
  // MAX_ROWS: from tenant quota.row_limit_per_dataset (default: 100)
  // MAX_TEXT_CHARS: canonical limit independent of source/language
  //
  // Important: This check is done before passing to worker.js,
  // so worker.js does not check and only processes validated JSONL files.

  // Check row count
  if (newRows.length > MAX_ROWS) {
    await failDatasetAndThrow("TOO_MANY_ROWS", {
      logDetails: { row_count: newRows.length, max_rows: MAX_ROWS }
    });
  }

  // Check text length (canonical limit)
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

  // Representative vector is updated by worker. Existing average needed for incremental calculation is preserved.

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
  // 6. Perform Diff (compare oldRows and newRows)
  // ========================================================================
  // Basic comparison by row_id, but if canonical text/meta differs, treat same row_id as re-upsert target.
  // - rowId is based on column values, so usually changes if content changes,
  // - but if only payload changes like row-level meta/profile, re-upsert with same rowId is needed.
  // ========================================================================
  // Create oldRowMap and newRowMap once and reuse
  const oldRowMap = new Map();
  oldRows.forEach((row) => oldRowMap.set(row.rowId, row));

  const newRowMap = new Map();
  newRows.forEach((row) => newRowMap.set(row.rowId, row));

  let toAdd = [];
  let toArchive = [];

  if (oldRows.length > 0) {
    // Classify new rows or rows with changed canonical text/meta as re-upsert targets
    newRows.forEach((row) => {
      const oldRow = oldRowMap.get(row.rowId);
      if (!oldRow) {
        // Newly added rows (rowId not in oldRowMap)
        toAdd.push(row);
        return;
      }
      if (getJsonlRowContentSignature(oldRow) !== getJsonlRowContentSignature(row)) {
        toAdd.push(row);
      }
    });

    // Deleted rows (rows only in old, based on rowId)
    oldRows.forEach((row) => {
      if (!newRowMap.has(row.rowId)) {
        toArchive.push(row);
      }
    });
  } else {
    // If actualOldJsonlPath is missing, add all rows anew
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

  // If no add/modify/delete differences from previous snapshot, update metadata only and exit.
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
      // If query fails, keep 0
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
  // 7. Convert to JSONL and save to GCS (create two files: full and working)
  // ========================================================================
  // 7-1. Full JSONL (for deletion detection): includes all newRows
  //      - Can compare with old_jsonl_path on next upload
  //      - Used in worker.js to identify deletions
  // 7-2. Working JSONL (for actual work): includes only toAdd
  //      - Used in worker.js for embedding creation and upsert tasks
  //      - Excludes unchanged rows to reduce cost

  // Include all newRows in JSONL (version info taken from oldRowMap)
  const rowsForFullJsonl = newRows.map((row) => {
    const oldRow = oldRowMap.get(row.rowId);
    if (oldRow) {
      // If rowId matches, content matches, so keep old version
      return { ...row, version: oldRow.version || 1 };
    } else {
      // New row: version 1
      return { ...row, version: 1 };
    }
  });
  const fullJsonlContent = rowsForFullJsonl
    .map((row) => serializeJsonlRow(row))
    .join("\n");

  // Save full JSONL file to GCS (for deletion detection)
  const fullJsonlFileName = `datasets/${tenant}/${finalDatasetId}/${Date.now()}_full.jsonl`;
  const fullJsonlFile = storage.bucket(bucket).file(fullJsonlFileName);
  await fullJsonlFile.save(fullJsonlContent, {
    metadata: {
      contentType: "application/x-ndjson",
      metadata: {
        tenant,
        dataset_id: finalDatasetId,
        type: "full" // For deletion detection
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

  // Working JSONL: includes only toAdd (exclude unchanged rows)
  const rowsForWorkerJsonl = toAdd.map((row) => {
    // New row: version 1
    return { ...row, version: 1 };
  });
  const workerJsonlContent = rowsForWorkerJsonl
    .map((row) => serializeJsonlRow(row))
    .join("\n");

  // Save working JSONL file to GCS (for actual work)
  const workerJsonlFileName = `datasets/${tenant}/${finalDatasetId}/${Date.now()}_worker.jsonl`;
  const workerJsonlFile = storage.bucket(bucket).file(workerJsonlFileName);
  await workerJsonlFile.save(workerJsonlContent, {
    metadata: {
      contentType: "application/x-ndjson",
      metadata: {
        tenant,
        dataset_id: finalDatasetId,
        type: "worker" // For actual work
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
  // 8. Token limit check (before updating dataset document, same as streamChatRag)
  // ========================================================================
  // Check token_used_billing_month against limit (base + addon) for billing month.
  // Worker uses tokens when creating embeddings, so if limit exceeded, fail immediately without creating/updating dataset document.
  const quotaCheckResult = await checkTokenLimit(tenant, {
    locale,
    tenantData: tenantData // Pass tenant data already read (to avoid duplicate queries)
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
      localizedErrorKey: "QUOTA_EXCEEDED_TOKEN" // Same message as streamChatRag ("Monthly token limit exceeded.")
    });
  }

  // ========================================================================
  // 9·10. Update dataset document: claim ownership → enqueue → conditional metadata update
  // ========================================================================
  // Important: fullJsonlGcsPath is stored only in GCS, not in Firestore
  // Store jsonl_paths in Firestore only after worker.js completes (data consistency)
  // rows, cols, pending_tasks_count, etc. are set at once via datasetPayload below

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

  // Persist task ID before enqueue so a quickly started worker can acquire the same lock.
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
    // If query fails, keep 0
  }

  const now = Date.now();
  const estimated_completion_seconds = estimateIngestCompletionSeconds({
    rowsToEmbed: toAdd.length,
    rowsToDelete: toArchive.length,
    pendingTasksCount: pending_tasks_count || 1
  });
  const datasetPayload = {
    ...buildDatasetMetadataPayload(now),
    pending_tasks_count, // Number of tasks queued (and in progress) at upload time
    estimated_completion_seconds,
    estimated_completion_at: now + estimated_completion_seconds * 1000,
    updated_at: now
  };

  // If worker already progressed to INDEXING/READY, do not revert status.
  // Update metadata and pending count only if this upload still owns them.
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

  // If google_sheets and refresh_token exists, encrypt with AES and store in tenant doc (decrypt for manual/auto sync)
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

  // Multilingual processing of success messages
  const successMessage = getDatasetSuccessMessage(locale, "upload");
  // Monthly audit: uploadDataset itself uses no tokens (embedding done by worker), no usages → skip scheduleAuditMonthlyAfterResponse call

  return {
    success: true,
    dataset_id: finalDatasetId,
    record_count: newRows.length,
    full_jsonl_path: fullJsonlGcsPath, // Full JSONL path (for next comparison, saved to Firestore after worker.js completes)
    worker_jsonl_path: workerJsonlGcsPath, // Working JSONL path (only changed rows)
    pending_tasks_count, // Number of tasks queued (and in progress)
    estimated_completion_seconds,
    estimated_completion_at: now + estimated_completion_seconds * 1000,
    message: successMessage
  };
}

module.exports = { uploadDataset, runUploadDataset };