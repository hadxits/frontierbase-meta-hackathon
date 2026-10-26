const Collection = require("@/const/firestore/Collection");
const {
  createDocumentHistoryTrigger,
  fingerprintByIncludingKeys,
} = require("./documentHistoryUtils");

/**
 * Firestore onDocumentWritten 트리거는 전체 문서를 넘기므로, 볼륨 큰 필드(embed_value 등)도
 * 메모리에 로드된다. 아래 키만 사용해 변경 판단/히스토리 저장에 쓰고, 그 외 필드는 참조하지 않는다.
 * 민감 정보(google_sheets_refresh_token_encrypted 등)는 tenant 문서에 저장되며, dataset 히스토리에는 의도적으로 포함하지 않는다.
 */

/** 변경 여부 판단에 사용할 컬럼만 비교 (embed_value 등 대용량 필드 제외) */
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

/** 히스토리에 저장할 때 선택할 컬럼 (embed_value 등 대용량 필드는 저장 안 함) */
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