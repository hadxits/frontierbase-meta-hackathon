/**
 * ============================================================================
 * checkTokenLimit.js - 토큰 사용량 한도 체크 유틸리티
 * ============================================================================
 *
 * 테넌트의 토큰 사용량이 한도를 초과했는지 확인합니다 (billing month 기준).
 * addon 토큰도 고려하여 체크합니다.
 *
 * @param {string} tenantId - 테넌트 ID
 * @param {Object} options - 선택적 옵션
 * @param {string} options.locale - 언어 코드 (예: "ko", "en", "ja")
 * @param {Object} options.tenantData - 이미 읽은 tenant 데이터 (선택, 있으면 Firestore 읽기 생략)
 * @returns {Promise<{exceeded: boolean, message?: string, details?: Object}>}
 *   - exceeded: 한도 초과 여부
 *   - message: 한도 초과 시 메시지 (locale 기반 다국어)
 *   - details: 상세 정보 (tokenLimitMonth, tokenUsedBillingMonth, baseTokenLimit, tokenBalance 등)
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logWarn, logAndCaptureError } = require("@/utils/logger");
const {
  hasAddonAvailable,
  getAddonAvailableTokens,
  processAddonStatus
} = require("@/utils/addonToken");
const { calculateBillingWindowForTenant } = require("@/utils/updateTokenUsage");

async function checkTokenLimit(tenantId, options = {}) {
  try {
    const locale = options.locale || null;
    const tenantData = options.tenantData; // 이미 읽은 tenant 데이터 (선택)

    let tenant;

    // tenantData가 제공되면 Firestore 읽기 생략
    if (tenantData) {
      tenant = tenantData;
    } else {
      // tenantData가 없으면 Firestore에서 읽기
      const tenantDoc = await store
          .collection(Collection.TENANTS)
          .doc(tenantId)
          .get();

      if (!tenantDoc.exists) {
        logWarn("[checkTokenLimit] Tenant 문서가 없음", {
          tenant_id: tenantId,
          function_name: "checkTokenLimit"
        });
        throw new Error(`Tenant document not found: ${tenantId}`);
      }

      tenant = tenantDoc.data();
    }
    const usage = {
      token_used_billing_month: 0,
      ...(tenant.usage || {})
    };
    const quota = {
      token_limit_month: 200_000,
      ...(tenant.quota || {})
    };
    const addonTokenArray = Array.isArray(tenant.addon_token) ? tenant.addon_token : [];
    const billing = {
      startDay: undefined,
      windowStartAt: null,
      windowEndAt: null,
      ...(tenant.billing || {})
    };

    const currentTime = Date.now();
    const now = new Date(currentTime);

    // ✅ 중요: billing window 만료 여부를 먼저 확인하여 올바른 사용량 기준으로 체크
    const billingWindowResult = calculateBillingWindowForTenant(billing, now);
    const shouldResetBillingMonth = billingWindowResult.shouldResetBillingMonth;

    // 기본 할당량 (Infinity는 무제한을 의미)
    const baseTokenLimit = quota.token_limit_month || Infinity;

    // F1) addon 활성화 여부 확인
    const isTokenAddonActive = hasAddonAvailable(addonTokenArray, currentTime);

    // F2) addon 잔액 계산 (활성화된 경우만)
    const tokenBalance = getAddonAvailableTokens(addonTokenArray, currentTime);

    // 총 한도 = 기본 한도 + addon 잔액
    const tokenLimitMonth =
        baseTokenLimit === Infinity ? Infinity : baseTokenLimit + tokenBalance;

    // ✅ 현재 사용량 (billing month 기준): shouldResetBillingMonth가 true면 0으로 간주
    const tokenUsedBillingMonth = shouldResetBillingMonth
      ? 0
      : usage.token_used_billing_month || 0;

    // 한도 초과 체크
    const exceeded = tokenLimitMonth !== Infinity &&
        tokenUsedBillingMonth >= tokenLimitMonth;

    const details = {
      baseTokenLimit,
      tokenBalance,
      isTokenAddonActive,
      tokenLimitMonth,
      tokenUsedBillingMonth,
      plan: tenant.plan || 'FREE'
    };

    if (exceeded) {
      logWarn("[checkTokenLimit] Token quota exceeded", {
        tenant_id: tenantId,
        function_name: "checkTokenLimit",
        extra: details
      });

      // locale 기반 다국어 메시지
      const localizedMessage = getLocalizedErrorMessage(
          locale,
          "QUOTA_EXCEEDED_TOKEN"
      );

      return {
        exceeded: true,
        message: localizedMessage,
        details
      };
    }

    return {
      exceeded: false,
      details
    };
  } catch (error) {
    // tenant 문서 없음으로 던진 에러는 호출부에서 종료
    if (error?.message?.includes("Tenant document not found")) {
      throw error;
    }
    logAndCaptureError(
        error,
        "[checkTokenLimit] Token limit check failed",
        {
          tenant_id: tenantId,
          function_name: "checkTokenLimit"
        }
    );
    // 체크 실패해도 계속 진행
    return { exceeded: false };
  }
}

module.exports = checkTokenLimit;