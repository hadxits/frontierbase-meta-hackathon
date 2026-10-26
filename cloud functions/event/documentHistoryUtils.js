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
 * 변경 여부 판단용 fingerprint: 지정한 키만 포함
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
 * 변경 여부 판단용 fingerprint: 지정한 키만 제외 (나머지 전체로 비교)
 */
function fingerprintByExcludingKeys(data, excludeKeys) {
  if (!data || typeof data !== "object") return "";
  const o = { ...data };
  excludeKeys.forEach((k) => delete o[k]);
  return stableStringify(o);
}

/**
 * 문서 쓰기 트리거 기반 히스토리 저장 공통 로직.
 * @param {object} options
 * @param {string} options.documentPath - Firestore 경로 (예: "tenants/{tenantId}/payments/{paymentId}")
 * @param {string} options.historyCollection - 서브컬렉션명 (Collection.PAYMENTS_HISTORY 등)
 * @param {function(object): string} options.getContentFingerprint - (data) => fingerprint 문자열
 * @param {function(object, object, string): object} options.buildPayload - (data, params, changeType) => 저장할 문서
 * @param {string} options.logPrefix - 로그용 이름 (예: "savePaymentsHistory")
 * @param {string[]} options.paramKeys - params에서 로그에 찍을 키 (예: ["tenantId", "paymentId"])
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

      // deleted일 때는 삭제 직전 상태(before)를 히스토리에 남김
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