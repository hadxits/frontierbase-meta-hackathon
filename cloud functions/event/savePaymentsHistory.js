const Collection = require("@/const/firestore/Collection");
const {
  createDocumentHistoryTrigger,
  fingerprintByExcludingKeys,
} = require("./documentHistoryUtils");

/** 제외하고 비교할 메타 필드 (이것만 바뀌었으면 변경으로 보지 않을 수 있음) */
const META_KEYS = new Set(["updated_at"]);

const savePaymentsHistory = createDocumentHistoryTrigger({
  documentPath: "tenants/{tenantId}/payments/{paymentId}",
  historyCollection: Collection.PAYMENTS_HISTORY,
  getContentFingerprint: (data) => fingerprintByExcludingKeys(data, META_KEYS),
  /** 히스토리 행이 Firestore에 추가된 시각(ms). payment 스냅샷의 created_at/updated_at과 구분. */
  buildPayload: (data) => ({ ...data, added_at: Date.now() }),
  logPrefix: "savePaymentsHistory",
  paramKeys: ["tenantId", "paymentId"],
});

module.exports = savePaymentsHistory;