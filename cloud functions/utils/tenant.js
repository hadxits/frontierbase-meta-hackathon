/**
 * ============================================================================
 * tenant.js - Tenant 관련 공통 유틸리티
 * ============================================================================
 *
 * Tenant 검증, 데이터 로드, Qdrant URL 검증 등 공통 로직을 제공합니다.
 * ============================================================================
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const ApiError = require("@/errors/apiError");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logOperationalWarn } = require("@/utils/logger");

/**
 * Tenant 검증 및 데이터 로드
 * @param {string} tenantId - 테넌트 ID
 * @param {Object} options - 옵션
 * @param {string} [options.locale] - 임시 locale (tenant 조회 전 에러 메시지용, 기본값: "en")
 * @param {string} [options.functionName] - 함수 이름 (로깅용)
 * @param {boolean} [options.requireQdrantUrl=true] - Qdrant URL 필수 여부
 * @returns {Promise<{tenantData: Object, locale: string, qdrant_url?: string}>}
 * @throws {ApiError} - Tenant가 없거나 Qdrant URL이 없을 때
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

  // Qdrant URL 검증 (필요한 경우)
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