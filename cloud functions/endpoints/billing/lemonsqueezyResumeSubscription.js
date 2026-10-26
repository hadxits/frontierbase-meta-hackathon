/**
 * 구독 취소 예약 철회 (Lemon 유예 기간 동안 cancelled → active 복구).
 *
 * - PATCH /v1/subscriptions/:id + attributes.cancelled: false
 * @see https://docs.lemonsqueezy.com/guides/developer-guide/managing-subscriptions#cancelling-and-resuming-subscriptions
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logAndCaptureError } = require("@/utils/logger");
const { lemonClient } = require("@/utils/lemonsqueezy");
const { retryOnceOn429 } = require("@/utils/retry");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const {
  assertActiveTenantAdmin,
  assertTenantOwnsSubscription,
} = require("@/utils/billingAuthorization");

const lemonsqueezyResumeSubscription = _onRequest({
  opts: { memory: "256MiB", maxInstances: 2, concurrency: 2 },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant_id: { type: PropertyType.STRING },
      subscription_id: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING },
    },
    required: ["tenant_id", "subscription_id"],
    additionalProperties: false,
  },
  handler: async (request) => {
    const locale = (request.body && request.body.locale) || "en";
    const { tenant_id: tenantId, subscription_id: subscriptionId } = request.body || {};
    const logTenantId = tenantId || `resume-${subscriptionId}`;

    try {
      await assertActiveTenantAdmin(tenantId, request.auth.uid, locale);
      await assertTenantOwnsSubscription(tenantId, subscriptionId, locale);

      const tenantRef = store.collection(Collection.TENANTS).doc(String(tenantId));
      const tenantSnap = await tenantRef.get();
      if (!tenantSnap.exists) {
        throw new ApiError({
          errorCode: "TENANT_NOT_FOUND",
          message: getLocalizedErrorMessage(locale, "TENANT_NOT_FOUND"),
          httpStatusCode: 404,
          returnToUser: true,
        });
      }

      const pending =
        tenantSnap.data()?.billing?.subscription_cancellation_pending || null;
      if (
        pending &&
        String(pending.subscription_id || "") !== String(subscriptionId)
      ) {
        throw new ApiError({
          errorCode: "RESUME_SUBSCRIPTION_MISMATCH",
          message: getLocalizedErrorMessage(
            locale,
            "BILLING_RESUME_SUBSCRIPTION_MISMATCH"
          ),
          httpStatusCode: 400,
          returnToUser: true,
        });
      }

      const client = lemonClient();
      const payload = {
        data: {
          type: "subscriptions",
          id: String(subscriptionId),
          attributes: {
            cancelled: false,
          },
        },
      };

      let res;
      try {
        res = await retryOnceOn429(() =>
          client.patch(
            `/subscriptions/${encodeURIComponent(subscriptionId)}`,
            payload
          )
        );
      } catch (err) {
        const status = err.response?.status;
        const data = err.response?.data;
        if (status === 404) {
          throw new ApiError({
            errorCode: "SUBSCRIPTION_NOT_FOUND",
            message: getLocalizedErrorMessage(
              locale,
              "BILLING_SUBSCRIPTION_NOT_FOUND"
            ),
            httpStatusCode: 404,
            returnToUser: true,
          });
        }
        const detail = data?.errors?.[0]?.detail;
        throw new ApiError({
          errorCode: "RESUME_FAILED",
          message: detail
            ? `${getLocalizedErrorMessage(locale, "BILLING_UPDATE_FAILED")} (${detail})`
            : getLocalizedErrorMessage(locale, "BILLING_UPDATE_FAILED"),
          httpStatusCode: status && status >= 400 ? status : 502,
          returnToUser: true,
        });
      }

      const attrs = res.data?.data?.attributes || {};
      const urls = attrs?.urls || {};
      const portalUrl =
        urls.customer_portal_update_subscription || urls.customer_portal || null;
      const now = Date.now();

      await tenantRef.update({
        "billing.subscription_cancellation_pending": null,
        updated_at: now,
      });

      return {
        resumed: true,
        tenant_id: String(tenantId),
        subscription_id: String(subscriptionId),
        renews_at: attrs.renews_at || null,
        ends_at: attrs.ends_at || null,
        cancelled: attrs.cancelled === true,
        requires_customer_portal: Boolean(portalUrl),
        customer_portal_url: portalUrl || null,
      };
    } catch (err) {
      if (!(err instanceof ApiError)) {
        logAndCaptureError(err, "[lemonsqueezyResumeSubscription] Unexpected error", {
          tenant_id: logTenantId,
          function_name: "lemonsqueezyResumeSubscription",
          extra: { subscription_id: subscriptionId, locale },
        });
        throw err;
      }
      logAndCaptureError(err, "[lemonsqueezyResumeSubscription] Billing error", {
        tenant_id: logTenantId,
        function_name: "lemonsqueezyResumeSubscription",
        extra: {
          errorCode: err.errorCode,
          subscription_id: subscriptionId,
          locale,
        },
      });
      throw err;
    }
  },
});

module.exports = lemonsqueezyResumeSubscription;