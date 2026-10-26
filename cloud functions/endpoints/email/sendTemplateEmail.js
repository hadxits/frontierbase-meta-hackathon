/**
 * ============================================================================
 * sendTemplateEmail.js - 템플릿 코드 기반 공통 이메일 전송 API
 * ============================================================================
 * - 클라이언트/서버에서 template_code로 호출 (예: "welcome", "dataset_ready", "dataset_deletion", "channel_deletion", "channel_invite", "support_confirmation").
 * - locale 기본값 적용 후 다국어 메일 전송.
 * - 발신: Resend API (EMAIL_USER / 도메인은 Resend에서 검증).
 * ============================================================================
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { TEMPLATE_CODES } = require("@/utils/emailTemplates");
const {
  coerceTemplateVariables,
  mergeVariablesFromRequestBody
} = require("@/utils/coerceTemplateVariables");
const { sendTemplateEmail } = require("@/utils/sendEmailCommon");

const VALID_TEMPLATE_CODES = Object.values(TEMPLATE_CODES).filter(
  (code) =>
    code !== TEMPLATE_CODES.PASSWORD_RESET &&
    code !== TEMPLATE_CODES.ISSUE_TRACK_USER_CONFIRMATION &&
    code !== TEMPLATE_CODES.ISSUE_TRACK_ADMIN_NOTIFICATION &&
    code !== TEMPLATE_CODES.ISSUE_TRACK_REPLY
);

/**
 * HTTP 엔드포인트와 동일한 본문 형식으로 템플릿 메일을 보냅니다.
 * 다른 Cloud Function에서 직접 호출할 때 사용합니다(응답 암호화/보안필터는 HTTP 레이어에만 해당).
 *
 * @param {Record<string, unknown>} body - template_code, to, locale?, variables? 등
 * @returns {Promise<{ success: boolean, messageId?: string }>}
 */
async function sendTemplateEmailFromBody(body) {
  const bodyObj =
    body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const templateCode = String(bodyObj.template_code || "")
    .trim()
    .toLowerCase();
  const to = bodyObj.to;
  const locale = String(bodyObj.locale || "en").trim() || "en";

  if (!VALID_TEMPLATE_CODES.includes(templateCode)) {
    throw new ApiError({
      errorCode: "INVALID_TEMPLATE_CODE",
      message: `template_code must be one of: ${VALID_TEMPLATE_CODES.join(", ")}`,
      httpStatusCode: 400,
      returnToUser: true
    });
  }

  const variables = coerceTemplateVariables(
    templateCode,
    mergeVariablesFromRequestBody(templateCode, bodyObj)
  );

  try {
    const result = await sendTemplateEmail({
      templateCode,
      to,
      locale,
      variables
    });
    return { success: result.success, messageId: result.messageId };
  } catch (err) {
    // 실패 시 로그/Sentry는 sendEmailCommon에서 이미 처리됨 (이중 capture 방지)
    throw new ApiError({
      errorCode: "EMAIL_SEND_FAILED",
      message: "Email could not be sent.",
      httpStatusCode: 502,
      returnToUser: true
    });
  }
}

const sendTemplateEmailHandler = _onRequest({
  opts: { memory: "256MiB", cpu: "gcf_gen1", maxInstances: 10, concurrency: 1 },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      template_code: { type: PropertyType.STRING },
      // Ajv 스키마: string 또는 string[] 허용
      to: {
        anyOf: [
          { type: PropertyType.STRING },
          { type: PropertyType.ARRAY, items: { type: PropertyType.STRING } }
        ]
      },
      locale: { type: PropertyType.STRING },
      variables: {
        anyOf: [
          { type: PropertyType.OBJECT, additionalProperties: true },
          { type: "null" }
        ]
      }
    },
    required: ["template_code", "to"],
    additionalProperties: true
  },
  handler: async (request) => sendTemplateEmailFromBody(request.body || {})
});

module.exports = Object.assign(sendTemplateEmailHandler, {
  sendTemplateEmailFromBody
});