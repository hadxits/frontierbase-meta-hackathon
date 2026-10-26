/**
 * ============================================================================
 * checkDatasetLimit.js - 데이터셋 개수 한도 체크 유틸리티
 * ============================================================================
 *
 * 테넌트의 quota.dataset_limit 대비 현재 datasets 개수를 확인합니다.
 * 기존 dataset 업데이트(재업로드)는 한도에 포함하지 않습니다.
 *
 * @param {string} tenantId - 테넌트 ID
 * @param {Object} options - 선택적 옵션
 * @param {string} [options.locale] - 언어 코드
 * @param {Object} [options.tenantData] - 이미 읽은 tenant 데이터
 * @param {boolean} [options.isExistingDataset] - true면 기존 dataset 업데이트 (체크 생략)
 * @returns {Promise<{exceeded: boolean, message?: string, details?: Object}>}
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const DatasetStatus = require("@/const/DatasetStatus");
const { getQuotaForPlan } = require("@/utils/planQuota");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logWarn, logAndCaptureError } = require("@/utils/logger");

async function checkDatasetLimit(tenantId, options = {}) {
  if (options.isExistingDataset === true) {
    return { exceeded: false };
  }

  try {
    const locale = options.locale || null;
    const tenantData = options.tenantData || {};
    const planQuota = getQuotaForPlan(tenantData.plan || "FREE");
    const quota = {
      ...planQuota,
      ...(tenantData.quota || {})
    };
    const datasetLimit = quota.dataset_limit;

    if (
      typeof datasetLimit !== "number" ||
      !Number.isFinite(datasetLimit) ||
      datasetLimit <= 0
    ) {
      return { exceeded: false };
    }

    // deleteDataset 은 문서를 지우지 않고 status=deleted 로만 표시하므로 제외
    const datasetsSnap = await store
      .collection(Collection.TENANTS)
      .doc(tenantId)
      .collection(Collection.DATASETS)
      .where("status", "!=", DatasetStatus.DELETED)
      .limit(datasetLimit)
      .select("dataset_id")
      .get();

    const currentCount = datasetsSnap.size;
    const details = {
      dataset_limit: datasetLimit,
      current_count: currentCount,
      plan: tenantData.plan || "FREE"
    };

    if (currentCount >= datasetLimit) {
      logWarn("[checkDatasetLimit] Dataset quota exceeded", {
        tenant_id: tenantId,
        function_name: "checkDatasetLimit",
        extra: details
      });

      const localizedMessage = getLocalizedErrorMessage(
        locale,
        "QUOTA_EXCEEDED_DATASET"
      ).replace(/\{max\}/g, String(datasetLimit));

      return {
        exceeded: true,
        message: localizedMessage,
        details
      };
    }

    return { exceeded: false, details };
  } catch (error) {
    logAndCaptureError(
      error,
      "[checkDatasetLimit] Dataset limit check failed",
      {
        tenant_id: tenantId,
        function_name: "checkDatasetLimit"
      }
    );
    return { exceeded: false };
  }
}

module.exports = checkDatasetLimit;