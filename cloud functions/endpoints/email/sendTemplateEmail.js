/**
 * ============================================================================
 * sendTemplateEmail.js - common email sending API based on template code.
 * ============================================================================
 * - Called by client/server with template_code (e.g., "welcome", "dataset_ready", "dataset_deletion", "channel_deletion", "channel_invite", "support_confirmation").
 * - Applies default locale then sends multilingual email.
 * - Sender: Resend API (EMAIL_USER / domain verified by Resend).
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
 * Sends template email with the same body format as HTTP endpoint.
 * Used for direct calls from other Cloud Functions (response encryption/security filters apply only at HTTP layer).
 *
 * @param {Record<string, unknown>} body - includes template_code, to, locale?, variables? etc.
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
    // On failure, logs/Sentry are already handled in sendEmailCommon (avoid duplicate capture).
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
      // Ajv schema: allows string or string[]
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