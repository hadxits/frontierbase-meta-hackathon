const Collection = require("@/const/firestore/Collection");
const {
  createDocumentHistoryTrigger,
  fingerprintByIncludingKeys,
} = require("./documentHistoryUtils");

/**
 * Firestore onDocumentWritten trigger passes the entire document, so large fields (like embed_value) are
 * loaded into memory. Only the keys below are used for change detection/history saving; other fields are not referenced.
 * Sensitive info (like google_sheets_refresh_token_encrypted) is stored in tenant documents and intentionally excluded from dataset history.
 */

/** Compare only columns used for change detection (exclude large fields like embed_value) */
const CHANGE_DETECTION_KEYS = [
  "cols",
  "deleted_at",
  "description",
  "error",
  "file_size",
  "name",
  "rows",
  "source_ref",
  "source_type",
  "status",
  "updated_at",
];

/** Columns selected for saving in history (exclude large fields like embed_value) */
const HISTORY_SELECT_KEYS = [
  "cols",
  "created_at",
  "dataset_id",
  "deleted_at",
  "description",
  "error",
  "file_size",
  "name",
  "rows",
  "source_ref",
  "source_type",
  "status",
  "tenant_id",
  "updated_at",
];

function buildHistoryPayload(data, params) {
  const { tenantId, datasetId } = params;
  const o = { tenant_id: tenantId, dataset_id: datasetId };
  HISTORY_SELECT_KEYS.forEach((k) => {
    if (k === "tenant_id" || k === "dataset_id") return;
    if (data && k in data) o[k] = data[k];
  });
  o.added_at = Date.now();
  return o;
}

const saveDatasetsHistory = createDocumentHistoryTrigger({
  documentPath: "tenants/{tenantId}/datasets/{datasetId}",
  historyCollection: Collection.DATASETS_HISTORY,
  getContentFingerprint: (data) =>
    fingerprintByIncludingKeys(data, CHANGE_DETECTION_KEYS),
  buildPayload: (data, params) => buildHistoryPayload(data, params),
  logPrefix: "saveDatasetsHistory",
  paramKeys: ["tenantId", "datasetId"],
});

module.exports = saveDatasetsHistory;