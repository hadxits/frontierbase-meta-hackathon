/**
 * Schedule subscription cancellation as "expire at period end (grace)".
 *
 * - PATCH /v1/subscriptions/:id + attributes.cancelled: true
 *   (Do not use DELETE — can restore with cancelled:false during grace period, same as Lemon guide)
 * - Store metadata in tenant.billing.subscription_cancellation_pending
 * - Remove scheduled plan changes (subscription_change_pending) to avoid conflicts.
 * - To withdraw during grace period: use lemonsqueezyResumeSubscription (PATCH cancelled:false)
 *
 * @see https://docs.lemonsqueezy.com/guides/developer-guide/managing-subscriptions#cancelling-and-resuming-subscriptions
 * @see https://docs.lemonsqueezy.com/api/subscriptions/update-subscription
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

const lemonsqueezyCancel = _onRequest({
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
    const { subscription_id, tenant_id: tenantId } = request.body || {};
    const logTenantId = tenantId || `cancel-${subscription_id}`;

    try {
      await assertActiveTenantAdmin(tenantId, request.auth.uid, locale);
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
      await assertTenantOwnsSubscription(tenantId, subscription_id, locale);

      const client = lemonClient();

      const payload = {
        data: {
          type: "subscriptions",
          id: String(subscription_id),
          attributes: {
            cancelled: true,
          },
        },
      };

      let res;
      try {
        res = await retryOnceOn429(() =>
          client.patch(
            `/subscriptions/${encodeURIComponent(subscription_id)}`,
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
          errorCode: "CANCEL_FAILED",
          message: detail
            ? `${getLocalizedErrorMessage(locale, "BILLING_CANCEL_FAILED")} (${detail})`
            : getLocalizedErrorMessage(locale, "BILLING_CANCEL_FAILED"),
          httpStatusCode: status && status >= 400 ? status : 502,
          returnToUser: true,
        });
      }

      const attrs = res.data?.data?.attributes || {};
      const urls = attrs?.urls || {};
      const portalUrl =
        urls.customer_portal_update_subscription || urls.customer_portal || null;
      const effectiveAt = attrs.ends_at || attrs.renews_at || null;
      const scheduledAt = Date.now();

      await tenantRef.update({
        "billing.subscription_change_pending": null,
        "billing.subscription_cancellation_pending": {
          status: "scheduled",
          subscription_id: String(subscription_id),
          scheduled_at: scheduledAt,
          effective_at: effectiveAt,
        },
        updated_at: scheduledAt,
      });

      return {
        cancelled: true,
        scheduled: true,
        subscription_id: String(subscription_id),
        effective_at: effectiveAt,
        renews_at: attrs.renews_at || null,
        ends_at: attrs.ends_at || null,
        requires_customer_portal: Boolean(portalUrl),
        customer_portal_url: portalUrl || null,
      };
    } catch (err) {
      if (err instanceof ApiError) {
        logAndCaptureError(err, "[lemonsqueezyCancel] Billing error", {
          tenant_id: logTenantId,
          function_name: "lemonsqueezyCancel",
          extra: { errorCode: err.errorCode, subscription_id, locale },
        });
      } else {
        logAndCaptureError(err, "[lemonsqueezyCancel] Unexpected error", {
          tenant_id: logTenantId,
          function_name: "lemonsqueezyCancel",
          extra: { subscription_id, locale },
        });
      }
      throw err;
    }
  },
});

module.exports = lemonsqueezyCancel;