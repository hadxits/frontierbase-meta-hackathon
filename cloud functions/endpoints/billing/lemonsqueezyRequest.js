/**
 * Create Lemon Squeezy checkout URL.
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const environment = require("@/env");
const ApiError = require("@/errors/apiError");
const { getLocalizedErrorMessage, getBillingCheckoutProductOptions } = require("@/utils/localization");
const { logAndCaptureError } = require("@/utils/logger");
const { lemonClient, getVariantInfo } = require("@/utils/lemonsqueezy");
const { retryOnceOn429 } = require("@/utils/retry");
const {
  assertActiveTenantAdmin,
} = require("@/utils/billingAuthorization");

const lemonsqueezyRequest = _onRequest({
  opts: { memory: "256MiB", maxInstances: 2, concurrency: 2 },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant_id: { type: PropertyType.STRING },
      variant_id: { oneOf: [{ type: PropertyType.NUMBER }, { type: PropertyType.STRING }] },
      redirect_url: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING },
      email: { type: PropertyType.STRING },
    },
    required: ["tenant_id", "variant_id"],
    additionalProperties: false,
  },
  handler: async (request) => {
    const locale = (request.body && request.body.locale) || "en";
    const { tenant_id, variant_id: rawVariantId, redirect_url, email } = request.body;

    try {
      const variant_id = Number(rawVariantId);
      if (!Number.isFinite(variant_id)) {
        throw new ApiError({
          errorCode: "INVALID_VARIANT",
          message: getLocalizedErrorMessage(locale, "BILLING_INVALID_VARIANT"),
          httpStatusCode: 400,
          returnToUser: true,
        });
      }
      const variant = getVariantInfo(variant_id);
      if (!variant) {
        throw new ApiError({
          errorCode: "INVALID_VARIANT",
          message: getLocalizedErrorMessage(locale, "BILLING_INVALID_VARIANT"),
          httpStatusCode: 400,
          returnToUser: true,
        });
      }

      await assertActiveTenantAdmin(tenant_id, request.auth.uid, locale);

      const storeId = environment.LEMON_SQUEEZY_STORE_ID;
      if (!storeId) {
        throw new ApiError({
          errorCode: "CONFIG_ERROR",
          message: getLocalizedErrorMessage(locale, "BILLING_CONFIG_ERROR"),
          httpStatusCode: 500,
          returnToUser: false,
        });
      }

      const client = lemonClient();
      const checkoutData = {
        custom: {
          tenant_id: String(tenant_id),
        },
      };
      const emailTrimmed = email && typeof email === "string" ? email.trim() : "";
      if (emailTrimmed) checkoutData.email = emailTrimmed;

      const body = {
        data: {
          type: "checkouts",
          attributes: {
            checkout_data: checkoutData,
          },
          relationships: {
            store: { data: { type: "stores", id: String(storeId) } },
            variant: { data: { type: "variants", id: String(variant_id) } },
          },
        },
      };

      const productOptions = {};
      if (redirect_url && typeof redirect_url === "string") {
        productOptions.redirect_url = redirect_url.trim();
      }
      const { name: productName, description: productDescription } = getBillingCheckoutProductOptions(locale, variant);
      if (productName) productOptions.name = productName;
      if (productDescription) productOptions.description = productDescription;
      if (Object.keys(productOptions).length > 0) {
        body.data.attributes.product_options = productOptions;
      }

      const res = await retryOnceOn429(() => client.post("/checkouts", body));

      const url = res.data?.data?.attributes?.url;
      if (!url) {
        throw new ApiError({
          errorCode: "CHECKOUT_FAILED",
          message: getLocalizedErrorMessage(locale, "BILLING_CHECKOUT_FAILED"),
          httpStatusCode: 502,
          returnToUser: true,
        });
      }

      return { checkout_url: url };
    } catch (err) {
      if (err instanceof ApiError) {
        logAndCaptureError(err, "[lemonsqueezyRequest] Billing error", {
          tenant_id: tenant_id || "billing-request",
          function_name: "lemonsqueezyRequest",
          extra: { errorCode: err.errorCode, locale },
        });
      } else {
        logAndCaptureError(err, "[lemonsqueezyRequest] Unexpected error", {
          tenant_id: tenant_id || "billing-request",
          function_name: "lemonsqueezyRequest",
          extra: { locale },
        });
      }
      throw err;
    }
  },
});

module.exports = lemonsqueezyRequest;