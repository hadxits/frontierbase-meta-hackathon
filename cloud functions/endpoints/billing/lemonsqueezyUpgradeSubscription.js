/**
 * Lemon Squeezy: immediate upgrade (subscription variant change + immediate proration billing).
 *
 * - PATCH /subscriptions/:id with invoice_immediately: true (Lemon guide: charge difference immediately).
 * - Do not include disable_prorations → distinguish from lemonsqueezyScheduleSubscriptionChange for downgrade/scheduled renewal.
 * - Allowed: plan tier upgrades (STARTER→PRO→ENTERPRISE) or monthly→annual switch within same tier.
 * - tenant.plan is updated via webhook (subscription_payment_success etc.); here only clear pending reservations.
 *
 * @see https://docs.lemonsqueezy.com/guides/tutorials/change-subscriber-plan
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

function isAllowedUpgrade(fromVariant, toVariant, fromVariantId, toVariantId) {
  if (!fromVariant || !toVariant) return false;
  if (Number(fromVariantId) === Number(toVariantId)) return false;
  const fromPlan = fromVariant.plan || "FREE";
  const toPlan = toVariant.plan || "FREE";
  if (planRank(toPlan) > planRank(fromPlan)) return true;
  if (fromPlan === toPlan && fromVariant.interval === "month" && toVariant.interval === "year") {
    return true;
  }
  return false;
}

const lemonsqueezyUpgradeSubscription = _onRequest({
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
    const logTenantId = tenantId || `upgrade-${subscription_id}`;

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

      const currentRes = await retryOnceOn429(() =>
        client.get(`/subscriptions/${encodeURIComponent(subscription_id)}`)
      );
      const currentAttrs = currentRes.data?.data?.attributes || {};
      const fromVariantId = currentAttrs.variant_id != null ? Number(currentAttrs.variant_id) : null;

      const fromVariant = Number.isFinite(fromVariantId) ? getVariantInfo(fromVariantId) : null;
      if (!fromVariant || fromVariant.kind !== "subscription") {
        throw new ApiError({
          errorCode: "INVALID_REQUEST",
          message: getLocalizedErrorMessage(locale, "BILLING_UPDATE_FAILED"),
          httpStatusCode: 400,
          returnToUser: true,
        });
      }

      if (!isAllowedUpgrade(fromVariant, variant, fromVariantId, variant_id)) {
        throw new ApiError({
          errorCode: "UPGRADE_NOT_ALLOWED",
          message: getLocalizedErrorMessage(locale, "BILLING_UPGRADE_NOT_ALLOWED"),
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
            invoice_immediately: true,
          },
        },
      };

      const res = await retryOnceOn429(() =>
        client.patch(`/subscriptions/${encodeURIComponent(subscription_id)}`, payload)
      );
      const attrs = res.data?.data?.attributes || {};
      const portalUrl = attrs?.urls?.customer_portal_update_subscription;

      const now = Date.now();
      await tenantRef.update({
        "billing.subscription_change_pending": null,
        updated_at: now,
      });

      return {
        upgraded: true,
        tenant_id: String(tenantId),
        subscription_id: String(subscription_id),
        from_variant_id: fromVariantId,
        to_variant_id: variant_id,
        renews_at: attrs.renews_at || null,
        ends_at: attrs.ends_at || null,
        requires_customer_portal: Boolean(portalUrl),
        customer_portal_url: portalUrl || null,
      };
    } catch (err) {
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

      logAndCaptureError(err, "[lemonsqueezyUpgradeSubscription] Error", {
        tenant_id: logTenantId,
        function_name: "lemonsqueezyUpgradeSubscription",
        extra: { tenant_id: tenantId, subscription_id, locale, errorCode: err.errorCode },
      });
      throw err;
    }
  },
});

module.exports = lemonsqueezyUpgradeSubscription;