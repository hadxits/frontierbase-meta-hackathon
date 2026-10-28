/**
 * ============================================================================
 * tenant.js - Common utilities related to Tenant.
 * ============================================================================
 *
 * Provides common logic for Tenant validation, data loading, Qdrant URL validation, etc.
 * ============================================================================
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const ApiError = require("@/errors/apiError");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logOperationalWarn } = require("@/utils/logger");

/**
 * Tenant validation and data loading.
 * @param {string} tenantId - Tenant ID
 * @param {Object} options - Options
 * @param {string} [options.locale] - Temporary locale (for error messages before tenant lookup, default: "en").
 * @param {string} [options.functionName] - Function name (for logging).
 * @param {boolean} [options.requireQdrantUrl=true] - Whether Qdrant URL is required.
 * @returns {Promise<{tenantData: Object, locale: string, qdrant_url?: string}>}
 * @throws {ApiError} - When Tenant or Qdrant URL is missing.
 */
async function loadAndValidateTenant(tenantId, options = {}) {
  const {
    locale: tempLocale = "en",
    functionName = "loadAndValidateTenant",
    requireQdrantUrl = true
  } = options;

  const tenantDoc = await store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .get();

  if (!tenantDoc.exists) {
    const error = new ApiError({
      errorCode: "TENANT_NOT_FOUND",
      message: getLocalizedErrorMessage(tempLocale, "TENANT_NOT_FOUND"),
      httpStatusCode: 404,
      returnToUser: true
    });
    logOperationalWarn(`[${functionName}] Tenant not found`, {
      tenant_id: tenantId,
      function_name: functionName,
      extra: { errorCode: "TENANT_NOT_FOUND" }
    });
    throw error;
  }

  const tenantData = tenantDoc.data();
  const locale = tenantData?.language || "en";

  const result = {
    tenantData,
    locale
  };

  // Qdrant URL validation (if needed).
  if (requireQdrantUrl) {
    const qdrant_url = tenantData?.qdrant_url;

    if (!qdrant_url || typeof qdrant_url !== "string" || qdrant_url.trim().length === 0) {
      logOperationalWarn(`[${functionName}] Missing Qdrant URL`, {
        tenant_id: tenantId,
        function_name: functionName,
        extra: { errorCode: "MISSING_QDRANT_URL" }
      });
      throw new ApiError({
        errorCode: "MISSING_QDRANT_URL",
        message: getLocalizedErrorMessage(locale, "MISSING_QDRANT_URL"),
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    result.qdrant_url = qdrant_url;
  }

  return result;
}

module.exports = {
  loadAndValidateTenant
};