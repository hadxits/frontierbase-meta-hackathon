/**
 * Disable MFA for logged-in user's own authentication app (TOTP).
 * Called by client when disabling in profile or switching to email OTP.
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const {
  unenrollTotpFactors,
  syncAuthenticatorEnabledFlag
} = require("@/utils/totpMfa");

const unenrollAuthenticator = _onRequest({
  opts: { memory: "256MiB", cpu: "gcf_gen1", maxInstances: 10, concurrency: 1 },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {},
    additionalProperties: true
  },
  handler: async (request) => {
    const uid = String(request.auth?.uid || "").trim();
    if (!uid) {
      throw new ApiError({
        errorCode: "UNAUTHENTICATED",
        message: "Authentication required.",
        httpStatusCode: 401,
        returnToUser: true
      });
    }

    const result = await unenrollTotpFactors(uid);
    await syncAuthenticatorEnabledFlag(uid, false);
    return result;
  }
});

module.exports = unenrollAuthenticator;
