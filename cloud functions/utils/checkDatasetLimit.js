/**
 * ============================================================================
 * checkDatasetLimit.js - Utility to check dataset count limits
 * ============================================================================
 *
 * Checks the current number of datasets against the tenant's quota.dataset_limit.
 * Updating an existing dataset (re-upload) is not counted toward the limit.
 *
 * @param {string} tenantId - Tenant ID
 * @param {Object} options - Optional parameters
 * @param {string} [options.locale] - Language code
 * @param {Object} [options.tenantData] - Tenant data already read
 * @param {boolean} [options.isExistingDataset] - True if updating an existing dataset (skip check)
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

    // deleteDataset marks status=deleted without deleting documents, so it is excluded.
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