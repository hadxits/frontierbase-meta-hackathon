const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { logger } = require("firebase-functions/v2");

function stableStringify(value) {
  if (value == null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * Fingerprint for change detection: includes only specified keys
 */
function fingerprintByIncludingKeys(data, includeKeys) {
  if (!data || typeof data !== "object") return "";
  const o = {};
  includeKeys.forEach((k) => {
    if (k in data) o[k] = data[k];
  });
  return stableStringify(o);
}

/**
 * Fingerprint for change detection: excludes specified keys (compare the rest)
 */
function fingerprintByExcludingKeys(data, excludeKeys) {
  if (!data || typeof data !== "object") return "";
  const o = { ...data };
  excludeKeys.forEach((k) => delete o[k]);
  return stableStringify(o);
}

/**
 * Common logic for saving history triggered by document writes.
 * @param {object} options
 * @param {string} options.documentPath - Firestore path (e.g., "tenants/{tenantId}/payments/{paymentId}")
 * @param {string} options.historyCollection - Subcollection name (e.g., Collection.PAYMENTS_HISTORY)
 * @param {function(object): string} options.getContentFingerprint - (data) => fingerprint string
 * @param {function(object, object, string): object} options.buildPayload - (data, params, changeType) => document to save
 * @param {string} options.logPrefix - Name for logging (e.g., "savePaymentsHistory")
 * @param {string[]} options.paramKeys - Keys from params to log (e.g., ["tenantId", "paymentId"])
 */
function createDocumentHistoryTrigger(options) {
  const {
    documentPath,
    historyCollection,
    getContentFingerprint,
    buildPayload,
    logPrefix,
    paramKeys,
  } = options;

  const toParamLog = (params) =>
    Object.fromEntries(paramKeys.map((k) => [k, params[k]]));

  return onDocumentWritten(
    {
      document: documentPath,
      cpu: "gcf_gen1"
    },
    async (event) => {
      const params = event.params;
      const before = event.data?.before?.exists ? event.data.before.data() : null;
      const after = event.data?.after?.exists ? event.data.after.data() : null;

      let changeType;
      if (!before && after) {
        changeType = "created";
      } else if (before && !after) {
        changeType = "deleted";
      } else if (before && after) {
        const fpBefore = getContentFingerprint(before);
        const fpAfter = getContentFingerprint(after);
        if (fpBefore === fpAfter) {
          logger.debug(`[${logPrefix}] no content change, skip`, toParamLog(params));
          return;
        }
        changeType = "updated";
      } else {
        return;
      }

      // When deleted, save the state before deletion in history
      const dataToSave = changeType === "deleted" ? before : after;
      const payload = buildPayload(dataToSave, params, changeType);

      if (payload == null) {
        logger.warn(`[${logPrefix}] buildPayload returned null, skip`, {
          ...toParamLog(params),
          changeType,
        });
        return;
      }

      const tenantId = params.tenantId;

      try {
        const ref = await store
          .collection(Collection.TENANTS)
          .doc(String(tenantId))
          .collection(historyCollection)
          .add(payload);
        logger.debug(`[${logPrefix}] saved`, {
          ...toParamLog(params),
          changeType,
          historyId: ref.id,
        });
      } catch (e) {
        logger.error(`[${logPrefix}] failed`, {
          ...toParamLog(params),
          changeType,
          error: e?.message ?? String(e),
        });
      }
    }
  );
}

module.exports = {
  stableStringify,
  fingerprintByIncludingKeys,
  fingerprintByExcludingKeys,
  createDocumentHistoryTrigger,
};