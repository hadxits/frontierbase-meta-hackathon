/**
 * Lemon Squeezy 구독 인보이스 PDF 생성 및 다운로드 URL 반환.
 * POST https://api.lemonsqueezy.com/v1/subscription-invoices/:id/generate-invoice
 *
 * Lemon 문서상 쿼리 파라미터로 청구지 정보를 전달하며, 응답 `meta.urls.download_invoice`에 서명된 다운로드 URL이 옵니다.
 * @see https://docs.lemonsqueezy.com/api/subscription-invoices/generate-subscription-invoice
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logAndCaptureError } = require("@/utils/logger");
const { lemonClient } = require("@/utils/lemonsqueezy");
const {
  assertActiveTenantAdmin,
  assertTenantOwnsInvoice,
} = require("@/utils/billingAuthorization");

const lemonsqueezyGenerateSubscriptionInvoice = _onRequest({
  opts: { memory: "256MiB", maxInstances: 2, concurrency: 2 },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant_id: { type: PropertyType.STRING },
      subscription_invoice_id: { type: PropertyType.STRING },
      name: { type: PropertyType.STRING },
      address: { type: PropertyType.STRING },
      city: { type: PropertyType.STRING },
      state: { type: PropertyType.STRING },
      zip_code: { type: PropertyType.STRING },
      country: { type: PropertyType.STRING },
      notes: { type: PropertyType.STRING },
      /** Lemon API 쿼리 `locale` (ISO 639, 예: en). 앱 에러 메시지용 `locale`과 구분. */
      invoice_locale: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING },
    },
    required: [
      "tenant_id",
      "subscription_invoice_id",
      "name",
      "address",
      "city",
      "zip_code",
      "country",
    ],
    additionalProperties: false,
  },
  handler: async (request) => {
    const locale = (request.body && request.body.locale) || "en";
    const {
      tenant_id: tenantId,
      subscription_invoice_id: subscriptionInvoiceId,
      name,
      address,
      city,
      state,
      zip_code: zipCode,
      country,
      notes,
      invoice_locale: invoiceLocale,
    } = request.body;

    const logTenantId = tenantId || `invoice-${subscriptionInvoiceId}`;

    const query = {
      name,
      address,
      city,
      zip_code: zipCode,
      country,
    };
    if (state !== undefined && state !== null && String(state).length > 0) {
      query.state = String(state);
    }
    if (notes !== undefined && notes !== null && String(notes).length > 0) {
      query.notes = String(notes);
    }
    if (
      invoiceLocale !== undefined &&
      invoiceLocale !== null &&
      String(invoiceLocale).length > 0
    ) {
      query.locale = String(invoiceLocale);
    }

    try {
      await assertActiveTenantAdmin(tenantId, request.auth.uid, locale);
      await assertTenantOwnsInvoice(
        tenantId,
        subscriptionInvoiceId,
        locale
      );

      const client = lemonClient();
      let res;
      try {
        res = await client.post(
          `/subscription-invoices/${encodeURIComponent(subscriptionInvoiceId)}/generate-invoice`,
          {},
          { params: query }
        );
      } catch (err) {
        const status = err.response?.status;
        const data = err.response?.data;
        if (status === 404) {
          throw new ApiError({
            errorCode: "SUBSCRIPTION_INVOICE_NOT_FOUND",
            message: getLocalizedErrorMessage(locale, "BILLING_INVOICE_NOT_FOUND"),
            httpStatusCode: 404,
            returnToUser: true,
          });
        }
        const detail = data?.errors?.[0]?.detail;
        throw new ApiError({
          errorCode: "INVOICE_GENERATION_FAILED",
          message: detail
            ? `${getLocalizedErrorMessage(locale, "BILLING_INVOICE_GENERATION_FAILED")} (${detail})`
            : getLocalizedErrorMessage(locale, "BILLING_INVOICE_GENERATION_FAILED"),
          httpStatusCode: status && status >= 400 ? status : 502,
          returnToUser: true,
        });
      }

      const downloadUrl = res?.data?.meta?.urls?.download_invoice;
      if (!downloadUrl || typeof downloadUrl !== "string") {
        throw new ApiError({
          errorCode: "INVOICE_GENERATION_FAILED",
          message: getLocalizedErrorMessage(locale, "BILLING_INVOICE_GENERATION_FAILED"),
          httpStatusCode: 502,
          returnToUser: true,
        });
      }

      return {
        subscription_invoice_id: subscriptionInvoiceId,
        download_invoice_url: downloadUrl,
      };
    } catch (err) {
      if (err instanceof ApiError) {
        logAndCaptureError(err, "[lemonsqueezyGenerateSubscriptionInvoice] Billing error", {
          tenant_id: logTenantId,
          function_name: "lemonsqueezyGenerateSubscriptionInvoice",
          extra: { errorCode: err.errorCode, subscription_invoice_id: subscriptionInvoiceId, locale },
        });
      } else {
        logAndCaptureError(err, "[lemonsqueezyGenerateSubscriptionInvoice] Unexpected error", {
          tenant_id: logTenantId,
          function_name: "lemonsqueezyGenerateSubscriptionInvoice",
          extra: { subscription_invoice_id: subscriptionInvoiceId, locale },
        });
      }
      throw err;
    }
  },
});

module.exports = lemonsqueezyGenerateSubscriptionInvoice;