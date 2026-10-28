/**
 * ============================================================================
 * checkTokenLimit.js - Utility to check token usage limits
 * ============================================================================
 *
 * Checks if the tenant's token usage exceeds the limit (billing month basis).
 * Includes addon tokens in the check.
 *
 * @param {string} tenantId - Tenant ID
 * @param {Object} options - Optional parameters
 * @param {string} options.locale - Language code (e.g., "ko", "en", "ja")
 * @param {Object} options.tenantData - Tenant data already read (optional, skips Firestore read if present)
 * @returns {Promise<{exceeded: boolean, message?: string, details?: Object}>}
 *   - exceeded: whether the limit is exceeded
 *   - message: message shown when limit is exceeded (localized)
 *   - details: detailed info (tokenLimitMonth, tokenUsedBillingMonth, baseTokenLimit, tokenBalance, etc.)
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
    const tenantData = options.tenantData; // Tenant data already read (optional)

    let tenant;

    // If tenantData is provided, skip Firestore read.
    if (tenantData) {
      tenant = tenantData;
    } else {
      // If tenantData is missing, read from Firestore.
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

    // ✅ Important: Check billing window expiration first to use correct usage baseline.
    const billingWindowResult = calculateBillingWindowForTenant(billing, now);
    const shouldResetBillingMonth = billingWindowResult.shouldResetBillingMonth;

    // Base quota (Infinity means unlimited).
    const baseTokenLimit = quota.token_limit_month || Infinity;

    // F1) Check if addon is active.
    const isTokenAddonActive = hasAddonAvailable(addonTokenArray, currentTime);

    // F2) Calculate addon balance (only if active).
    const tokenBalance = getAddonAvailableTokens(addonTokenArray, currentTime);

    // Total limit = base limit + addon balance.
    const tokenLimitMonth =
        baseTokenLimit === Infinity ? Infinity : baseTokenLimit + tokenBalance;

    // ✅ Current usage (billing month basis): if shouldResetBillingMonth is true, treat as zero.
    const tokenUsedBillingMonth = shouldResetBillingMonth
      ? 0
      : usage.token_used_billing_month || 0;

    // Check if limit is exceeded.
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

      // Localized messages based on locale.
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
    // Errors thrown due to missing tenant document are handled by the caller.
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
    // Continue even if the check fails.
    return { exceeded: false };
  }
}

module.exports = checkTokenLimit;