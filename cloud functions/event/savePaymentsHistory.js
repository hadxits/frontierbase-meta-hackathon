const Collection = require("@/const/firestore/Collection");
const {
  createDocumentHistoryTrigger,
  fingerprintByExcludingKeys,
} = require("./documentHistoryUtils");

/** Meta fields excluded from comparison (if only these change, it may not be considered a change) */
const META_KEYS = new Set(["updated_at"]);

const savePaymentsHistory = createDocumentHistoryTrigger({
  documentPath: "tenants/{tenantId}/payments/{paymentId}",
  historyCollection: Collection.PAYMENTS_HISTORY,
  getContentFingerprint: (data) => fingerprintByExcludingKeys(data, META_KEYS),
  /** Timestamp (ms) when the history entry was added to Firestore, distinct from payment snapshot's created_at/updated_at. */
  buildPayload: (data) => ({ ...data, added_at: Date.now() }),
  logPrefix: "savePaymentsHistory",
  paramKeys: ["tenantId", "paymentId"],
});

module.exports = savePaymentsHistory;