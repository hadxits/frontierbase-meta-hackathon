/**
 * 이메일 OTP 로그인 — 인증 코드 검증 후 Firebase custom token 발급 (purpose 기반)
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const { getAllEmailLoginCorsOrigins } = require("@/const/emailLoginConfig");
const { verifyEmailLoginCodeRequest } = require("@/utils/emailLoginService");

const verifyEmailLoginCode = _onRequest({
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
      code: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING }
    },
    required: ["purpose", "email", "code"],
    additionalProperties: false
  },
  handler: async (request) => {
    const body = request.body || {};
    return verifyEmailLoginCodeRequest({
      purpose: body.purpose,
      email: body.email,
      code: body.code,
      locale: body.locale
    });
  }
});

module.exports = verifyEmailLoginCode;