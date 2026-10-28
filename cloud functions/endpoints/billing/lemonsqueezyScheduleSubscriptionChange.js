/**
 * Schedule a Lemon Squeezy subscription change (reservation).
 *
 * IMPORTANT:
 * - According to Lemon docs, variant changes apply immediately, but with disable_prorations+invoice_immediately:false,
 *   adjust to a flow where new price is charged from next renewal without extra billing (scheduled downgrade).
 * - Do not change tenant.plan here; apply only at next successful payment (subscription_payment_success event).
 * - Save reservation info in tenant document: tenant.billing.subscription_change_pending.
 * - Do not allow plan tier upgrades here → use lemonsqueezyUpgradeSubscription instead.
 * - Only schedule renewal time changes like downgrades (reject same variant / same plan tier).
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logAndCaptureError } = require("@/utils/logger");
const { lemonClient, getVariantInfo } = require("@/utils/lemonsqueezy");
const { retryOnceOn429 } = require("@/utils/retry");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const {
  assertActiveTenantAdmin,
  assertTenantOwnsSubscription,
} = require("@/utils/billingAuthorization");

function planRank(plan) {
  if (plan === "ENTERPRISE") return 3;
  if (plan === "PRO") return 2;
  if (plan === "STARTER") return 1;
  return 0;
}

const lemonsqueezyScheduleSubscriptionChange = _onRequest({
  opts: { memory: "256MiB", maxInstances: 2, concurrency: 2 },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant_id: { type: PropertyType.STRING },
      subscription_id: { type: PropertyType.STRING },
      variant_id: { oneOf: [{ type: PropertyType.NUMBER }, { type: PropertyType.STRING }] },
      locale: { type: PropertyType.STRING },
    },
    required: ["tenant_id", "subscription_id", "variant_id"],
    additionalProperties: false,
  },
  handler: async (request) => {
    const locale = (request.body && request.body.locale) || "en";
    const { tenant_id: tenantId, subscription_id, variant_id: rawVariantId } = request.body;
    const logTenantId = tenantId || `schedule-${subscription_id}`;

    try {
      const variant_id = Number(rawVariantId);
      const variant = Number.isFinite(variant_id) ? getVariantInfo(variant_id) : null;
      if (!variant || variant.kind !== "subscription") {
        throw new ApiError({
          errorCode: "INVALID_VARIANT",
          message: getLocalizedErrorMessage(locale, "BILLING_INVALID_VARIANT"),
          httpStatusCode: 400,
          returnToUser: true,
        });
      }

      await assertActiveTenantAdmin(tenantId, request.auth.uid, locale);
      await assertTenantOwnsSubscription(tenantId, subscription_id, locale);

      const client = lemonClient();

      // Fetch current subscription before scheduling (to store "from" state)
      const currentRes = await retryOnceOn429(() =>
        client.get(`/subscriptions/${encodeURIComponent(subscription_id)}`)
      );
      const current = currentRes.data?.data;
      const currentAttrs = current?.attributes || {};
      const fromVariantId = currentAttrs.variant_id != null ? Number(currentAttrs.variant_id) : null;
      const renewsAt = currentAttrs.renews_at || null;

      const fromVariant = Number.isFinite(fromVariantId) ? getVariantInfo(fromVariantId) : null;
      if (!fromVariant || fromVariant.kind !== "subscription") {
        throw new ApiError({
          errorCode: "INVALID_REQUEST",
          message: getLocalizedErrorMessage(locale, "BILLING_UPDATE_FAILED"),
          httpStatusCode: 400,
          returnToUser: true,
        });
      }

      const fromPlanKey = fromVariant.plan || "FREE";
      const toPlanKey = variant.plan || "FREE";
      if (Number(fromVariantId) === Number(variant_id) || fromPlanKey === toPlanKey) {
        throw new ApiError({
          errorCode: "SAME_PLAN_NOT_ALLOWED",
          message: getLocalizedErrorMessage(locale, "BILLING_SAME_PLAN_NOT_ALLOWED"),
          httpStatusCode: 400,
          returnToUser: true,
        });
      }

      if (planRank(toPlanKey) > planRank(fromPlanKey)) {
        throw new ApiError({
          errorCode: "SCHEDULE_TIER_UPGRADE_NOT_ALLOWED",
          message: getLocalizedErrorMessage(locale, "BILLING_SCHEDULE_USE_UPGRADE_ENDPOINT"),
          httpStatusCode: 400,
          returnToUser: true,
        });
      }

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

      const payload = {
        data: {
          type: "subscriptions",
          id: String(subscription_id),
          attributes: {
            variant_id,
            // Reservation change concept: apply from next renewal without immediate billing or proration.
            disable_prorations: true,
            invoice_immediately: false,
          },
        },
      };

      const res = await retryOnceOn429(() =>
        client.patch(`/subscriptions/${encodeURIComponent(subscription_id)}`, payload)
      );
      const attrs = res.data?.data?.attributes || {};
      const portalUrl = attrs?.urls?.customer_portal_update_subscription;

      const fromPlan = tenantSnap.data()?.plan || null;
      const toPlan = variant.plan || null;
      const scheduledAt = Date.now();

      await tenantRef.update({
        "billing.subscription_change_pending": {
          status: "scheduled",
          subscription_id: String(subscription_id),
          from_variant_id: fromVariantId,
          to_variant_id: variant_id,
          from_plan: fromPlan,
          to_plan: toPlan,
          scheduled_at: scheduledAt,
          effective_at: renewsAt,
        },
        updated_at: scheduledAt,
      });

      return {
        scheduled: true,
        tenant_id: String(tenantId),
        subscription_id: String(subscription_id),
        from_variant_id: fromVariantId,
        to_variant_id: variant_id,
        effective_at: renewsAt,
        // Lemon docs: PayPal payment subscriptions may not accept PATCH, so provide customer_portal_update_subscription URL.
        requires_customer_portal: Boolean(portalUrl),
        // Unify on client side using customer_portal_url.
        customer_portal_url: portalUrl || null,
      };
    } catch (err) {
      // Wrap Axios errors as ApiError to localize user messages.
      if (!(err instanceof ApiError)) {
        const status = err.response?.status;
        const detail = err.response?.data?.errors?.[0]?.detail;
        const baseMsg = getLocalizedErrorMessage(locale, "BILLING_UPDATE_FAILED");
        const msg = detail ? `${baseMsg} (${detail})` : baseMsg;
        err = new ApiError({
          errorCode: "UPDATE_FAILED",
          message: msg,
          httpStatusCode: status && status >= 400 ? status : 502,
          returnToUser: true,
        });
      }

      logAndCaptureError(err, "[lemonsqueezyScheduleSubscriptionChange] Error", {
        tenant_id: logTenantId,
        function_name: "lemonsqueezyScheduleSubscriptionChange",
        extra: { tenant_id: tenantId, subscription_id, locale, errorCode: err.errorCode },
      });
      throw err;
    }
  },
});

module.exports = lemonsqueezyScheduleSubscriptionChange;