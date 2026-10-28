/**
 * Check if authentication app (TOTP) is registered in Firebase.
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { listTotpFactors } = require("@/utils/totpMfa");

const getAuthenticatorStatus = _onRequest({
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

    const factors = await listTotpFactors(uid);
    return {
      enrolled: factors.length > 0,
      count: factors.length
    };
  }
});

module.exports = getAuthenticatorStatus;
