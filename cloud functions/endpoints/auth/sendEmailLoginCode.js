/**
 * Email OTP login — send authentication code (based on purpose)
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const { getAllEmailLoginCorsOrigins } = require("@/const/emailLoginConfig");
const { sendEmailLoginCodeRequest } = require("@/utils/emailLoginService");

const sendEmailLoginCode = _onRequest({
  opts: {
    memory: "256MiB",
    cors: getAllEmailLoginCorsOrigins(),
    cpu: "gcf_gen1",
    maxInstances: 3,
    concurrency: 1
  },
  requireCredential: false,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      purpose: { type: PropertyType.STRING },
      email: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING }
    },
    required: ["purpose", "email"],
    additionalProperties: false
  },
  handler: async (request) => {
    const body = request.body || {};
    return sendEmailLoginCodeRequest({
      purpose: body.purpose,
      email: body.email,
      locale: body.locale,
      functionName: "sendEmailLoginCode"
    });
  }
});

module.exports = sendEmailLoginCode;