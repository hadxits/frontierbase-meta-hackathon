/**
 * 다운그레이드(등) 예약 변경 철회 — Cancel a scheduled subscription change.
 *
 * - Lemon: PATCH subscription 으로 variant_id 를 예약 전(from_variant_id)으로 되돌립니다.
 * - tenant.billing.subscription_change_pending 을 제거합니다.
 * - tenant.plan 은 여기서 바꾸지 않습니다. (subscription_payment_success 시점에 반영)
 *
 * 구독 해지 예약 철회(cancelled:false)는 lemonsqueezyResumeSubscription 을 사용하세요.
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
} = require("@/utils/billingAuthorization");

const lemonsqueezyCancelScheduledSubscriptionChange = _onRequest({
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
    const tenantRef = store.collection(Collection.TENANTS).doc(String(tenantId));

    try {
      await assertActiveTenantAdmin(tenantId, request.auth.uid, locale);

      const tenantSnap = await tenantRef.get();
      if (!tenantSnap.exists) {
        throw new ApiError({
          errorCode: "TENANT_NOT_FOUND",
          message: getLocalizedErrorMessage(locale, "TENANT_NOT_FOUND"),
          httpStatusCode: 404,
          returnToUser: true,
        });
      }

      const pending = tenantSnap.data()?.billing?.subscription_change_pending || null;
      if (!pending) {
        return { cancelled: true, had_pending: false };
      }

      const subscriptionId = String(pending.subscription_id || "");
      const fromVariantId = Number(pending.from_variant_id);
      const fromVariant = Number.isFinite(fromVariantId) ? getVariantInfo(fromVariantId) : null;
      if (!subscriptionId || !fromVariant || fromVariant.kind !== "subscription") {
        // 예약 정보가 깨져 있으면 tenant 쪽만 정리
        await tenantRef.update({
          "billing.subscription_change_pending": null,
          updated_at: Date.now(),
        });
        return { cancelled: true, had_pending: true, restored: false };
      }

      const client = lemonClient();
      const payload = {
        data: {
          type: "subscriptions",
          id: subscriptionId,
          attributes: {
            variant_id: fromVariantId,
            disable_prorations: true,
            invoice_immediately: false,
          },
        },
      };

      const res = await retryOnceOn429(() =>
        client.patch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, payload)
      );
      const attrs = res.data?.data?.attributes || {};
      const portalUrl = attrs?.urls?.customer_portal_update_subscription;

      await tenantRef.update({
        "billing.subscription_change_pending": null,
        updated_at: Date.now(),
      });

      return {
        cancelled: true,
        had_pending: true,
        subscription_id: subscriptionId,
        restored_variant_id: fromVariantId,
        requires_customer_portal: Boolean(portalUrl),
        customer_portal_update_subscription_url: portalUrl || null,
      };
    } catch (err) {
      if (!(err instanceof ApiError)) {
        const status = err.response?.status;
        const detail = err.response?.data?.errors?.[0]?.detail;
        const baseMsg = getLocalizedErrorMessage(locale, "BILLING_UPDATE_FAILED");
        const msg = detail ? `${baseMsg} (${detail})` : baseMsg;
        err = new ApiError({
          errorCode: "CANCEL_SCHEDULE_FAILED",
          message: msg,
          httpStatusCode: status && status >= 400 ? status : 502,
          returnToUser: true,
        });
      }

      logAndCaptureError(err, "[lemonsqueezyCancelScheduledSubscriptionChange] Error", {
        tenant_id: String(tenantId),
        function_name: "lemonsqueezyCancelScheduledSubscriptionChange",
        extra: { tenant_id: tenantId, locale, errorCode: err.errorCode },
      });
      throw err;
    }
  },
});

module.exports = lemonsqueezyCancelScheduledSubscriptionChange;