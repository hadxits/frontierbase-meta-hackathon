/**
 * 구독 중인 Lemon Squeezy 구독 링크를 반환합니다.
 * - tenant_id로 해당 tenant의 payment 스냅샷 중 status가 "active"인 것만 조회합니다.
 * - 여러 active 레코드가 있을 수 있으므로, subscription_ref 후보를 정렬해 Lemon Squeezy에서 실제 활성 상태인지 확인합니다.
 * - 반환 형식: { subscription_id, subscription_status, customer_portal, customer_portal_url, update_payment_method_url?, subscription_url? }
 *
 * @example customer_portal: https://my-store.lemonsqueezy.com/billing?expires=...&signature=...
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logAndCaptureError } = require("@/utils/logger");
const { lemonClient, mapSubscriptionStatus } = require("@/utils/lemonsqueezy");
const { retryOnceOn429 } = require("@/utils/retry");
const {
  assertActiveTenantAdmin,
} = require("@/utils/billingAuthorization");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");

const LEMON_SQUEEZY_API_BASE = "https://api.lemonsqueezy.com/v1";
const MAX_CANDIDATES = 20;
const MAX_VALIDATE_ATTEMPTS = 5;

const lemonsqueezyGetSubscriptionLink = _onRequest({
  opts: { memory: "256MiB", maxInstances: 2, concurrency: 2 },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant_id: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING },
    },
    required: ["tenant_id"],
    additionalProperties: false,
  },
  handler: async (request) => {
    const locale = (request.body && request.body.locale) || "en";
    const { tenant_id: tenantId } = request.body;

    try {
      await assertActiveTenantAdmin(tenantId, request.auth.uid, locale);

      const tenantRef = store.collection(Collection.TENANTS).doc(tenantId);
      const paymentsSnap = await tenantRef
        .collection(Collection.PAYMENTS)
        .where("status", "==", "active")
        // Keep query simple (single equality filter) to avoid composite index requirements.
        // We only project fields we need to minimize read payload.
        .select("subscription_ref", "kind", "provider", "current_period_end", "updated_at")
        .limit(MAX_CANDIDATES)
        .get();

      if (paymentsSnap.empty) {
        throw new ApiError({
          errorCode: "SUBSCRIPTION_NOT_FOUND",
          message: getLocalizedErrorMessage(locale, "BILLING_SUBSCRIPTION_NOT_FOUND"),
          httpStatusCode: 404,
          returnToUser: true,
        });
      }

      // Build candidate list deterministically (best-first).
      const candidates = [];
      for (const doc of paymentsSnap.docs) {
        const kind = String(doc.get("kind") || "");
        const provider = String(doc.get("provider") || "");
        const status = String(doc.get("status") || "");
        if (kind && kind !== "subscription") continue;
        if (provider && provider !== "lemonsqueezy") continue;
        if (status && status !== "active") continue;

        const subscriptionRef = doc.get("subscription_ref");
        const subscriptionId = String(subscriptionRef || "").trim();
        if (!subscriptionId) continue;

        const periodEndRaw = doc.get("current_period_end");
        const updatedAtRaw = doc.get("updated_at");
        const periodEnd = Number.isFinite(Number(periodEndRaw)) ? Number(periodEndRaw) : -1;
        const updatedAt = Number.isFinite(Number(updatedAtRaw)) ? Number(updatedAtRaw) : -1;

        candidates.push({ subscriptionId, periodEnd, updatedAt });
      }

      candidates.sort((a, b) => {
        if (b.periodEnd !== a.periodEnd) return b.periodEnd - a.periodEnd;
        return b.updatedAt - a.updatedAt;
      });

      if (candidates.length === 0) {
        throw new ApiError({
          errorCode: "SUBSCRIPTION_NOT_FOUND",
          message: getLocalizedErrorMessage(locale, "BILLING_SUBSCRIPTION_NOT_FOUND"),
          httpStatusCode: 404,
          returnToUser: true,
        });
      }

      const client = lemonClient();
      // Validate subscription with Lemon Squeezy (aligns with other billing endpoints usage of lemonClient).
      // This guards against stale payment snapshots (e.g., cancelled/expired on provider side).
      let resolved = {};
      for (const c of candidates.slice(0, MAX_VALIDATE_ATTEMPTS)) {
        let subRes;
        try {
          subRes = await retryOnceOn429(() =>
            client.get(`/subscriptions/${encodeURIComponent(c.subscriptionId)}`)
          );
        } catch (err) {
          const status = err.response?.status;
          const data = err.response?.data;
          if (status === 404) {
            // Candidate not found on provider side; try next.
            continue;
          }
          const detail = data?.errors?.[0]?.detail;
          throw new ApiError({
            errorCode: "SUBSCRIPTION_FETCH_FAILED",
            message: detail
              ? `${getLocalizedErrorMessage(locale, "BILLING_UPDATE_FAILED")} (${detail})`
              : getLocalizedErrorMessage(locale, "BILLING_UPDATE_FAILED"),
            httpStatusCode: status && status >= 400 ? status : 502,
            returnToUser: true,
          });
        }

        const subData = subRes?.data?.data;
        if (!subData || subData.type !== "subscriptions") {
          continue;
        }

        const raw = subRes?.data;
        const providerStatus = subData?.attributes?.status;
        const mappedStatus = mapSubscriptionStatus(providerStatus);
        if (mappedStatus !== "active" && mappedStatus !== "trialing") {
          continue;
        }

        // User-required extraction shape (support multiple response shapes defensively):
        // - res.data?.attributes?.url?.customer_portal
        // - res.data?.data?.attributes?.url?.customer_portal
        // - res.data?.data?.attributes?.urls?.customer_portal (official JSON:API style)
        const customerPortal =
          raw?.attributes?.url?.customer_portal
            ? String(raw.attributes.url.customer_portal)
            : raw?.data?.attributes?.url?.customer_portal
              ? String(raw.data.attributes.url.customer_portal)
              : raw?.data?.attributes?.urls?.customer_portal
                ? String(raw.data.attributes.urls.customer_portal)
                : "";

        const updatePaymentMethodUrl =
          raw?.attributes?.url?.update_payment_method
            ? String(raw.attributes.url.update_payment_method)
            : raw?.data?.attributes?.url?.update_payment_method
              ? String(raw.data.attributes.url.update_payment_method)
              : raw?.data?.attributes?.urls?.update_payment_method
                ? String(raw.data.attributes.urls.update_payment_method)
                : "";

        const apiSelf =
          raw?.links?.self ||
          subData?.links?.self ||
          `${LEMON_SQUEEZY_API_BASE}/subscriptions/${encodeURIComponent(c.subscriptionId)}`;

        resolved = {
          subscriptionId: c.subscriptionId,
          subscriptionUrl: String(apiSelf),
          subscriptionStatus: mappedStatus,
          customerPortal,
          updatePaymentMethodUrl,
        };
        break;
      }

      if (!resolved?.subscriptionId) {
        throw new ApiError({
          errorCode: "SUBSCRIPTION_NOT_FOUND",
          message: getLocalizedErrorMessage(locale, "BILLING_SUBSCRIPTION_NOT_FOUND"),
          httpStatusCode: 404,
          returnToUser: true,
        });
      }

      return {
        subscription_id: resolved.subscriptionId,
        subscription_status: resolved.subscriptionStatus,
        customer_portal: resolved.customerPortal || undefined,
        customer_portal_url: resolved.customerPortal || undefined,
        update_payment_method_url: resolved.updatePaymentMethodUrl || undefined,
        subscription_url: resolved.subscriptionUrl || undefined,
      };
    } catch (err) {
      if (err instanceof ApiError) {
        logAndCaptureError(err, "[lemonsqueezyGetSubscriptionLink] Billing error", {
          tenant_id: tenantId,
          function_name: "lemonsqueezyGetSubscriptionLink",
          extra: { errorCode: err.errorCode, locale },
        });
      } else {
        logAndCaptureError(err, "[lemonsqueezyGetSubscriptionLink] Unexpected error", {
          tenant_id: tenantId,
          function_name: "lemonsqueezyGetSubscriptionLink",
          extra: { locale },
        });
      }
      throw err;
    }
  },
});

module.exports = lemonsqueezyGetSubscriptionLink;