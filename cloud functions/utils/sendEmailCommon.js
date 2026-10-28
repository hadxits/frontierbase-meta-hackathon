/**
 * ============================================================================
 * sendEmailCommon.js - Common email sending (Resend API)
 * ============================================================================
 * - Sends template emails like signup welcome and dataset ready.
 * - Requires RESEND_API_KEY and verified sender address (EMAIL_USER) in Resend.
 * ============================================================================
 */
const { Resend } = require("resend");
const environment = require("@/env");
const { getSubject, getHtml } = require("@/utils/emailTemplates");
const { logInfo, logWarn, logAndCaptureError } = require("@/utils/logger");

const FROM_EMAIL = environment.EMAIL_USER || "service@frontierbase.io";
const FROM_NAME = environment.EMAIL_FROM_NAME || "FrontierBase Team";

/** For logger/Sentry convention. Email sending is system-level, independent of tenant (like health). */
const logCtx = (rest) => ({ tenant_id: "system", ...rest });

let cachedResend = null;
let cachedResendForKey = null;

function getResend() {
  const key = environment.RESEND_API_KEY && String(environment.RESEND_API_KEY).trim();
  if (!key) {
    return null;
  }
  if (cachedResend && cachedResendForKey === key) {
    return cachedResend;
  }
  cachedResendForKey = key;
  cachedResend = new Resend(key);
  return cachedResend;
}

function resendErrorToError(resendError) {
  const err = new Error(resendError?.message || "Resend API error");
  if (resendError?.name) {
    err.code = resendError.name;
  }
  if (resendError?.statusCode != null) {
    err.statusCode = resendError.statusCode;
  }
  return err;
}

/**
 * Send email using template code (locale-based multilingual).
 * @param {Object} options
 * @param {string} options.templateCode - Email template code (e.g., "welcome", "dataset_ready", "dataset_deletion").
 * @param {string|string[]} options.to - Recipient email(s) (string or array).
 * @param {string} [options.locale="en"] - Locale (default is en).
 * @param {Object} [options.variables={}] - Template variables (e.g., displayName, datasetName, sender, channelName, inviteUrl, senderPhotoUrl, ctaButtonColor).
 * @param {string|string[]} [options.replyTo] - Reply-To (Resend reply_to). Replies go to this address instead of From.
 * @returns {Promise<{ success: boolean, messageId?: string }>}
 */
async function sendTemplateEmail({
  templateCode,
  to,
  locale = "en",
  variables = {},
  replyTo,
}) {
  const resend = getResend();
  if (!resend) {
    logWarn("[sendEmailCommon] RESEND_API_KEY not set, skip sending", logCtx({
      function_name: "sendTemplateEmail",
      extra: { templateCode, to: Array.isArray(to) ? to[0] : to },
    }));
    logAndCaptureError(
      new Error("RESEND_API_KEY is not configured"),
      "[sendEmailCommon] RESEND_API_KEY not set, skip sending",
      logCtx({
        function_name: "sendTemplateEmail",
        extra: { templateCode, to: Array.isArray(to) ? to[0] : to },
      })
    );
    return { success: false };
  }

  const toList = Array.isArray(to) ? to : [to];
  const normalizedTo = toList
    .map((e) => (typeof e === "string" ? e.trim() : String(e?.email || e).trim()))
    .filter(Boolean);

  if (normalizedTo.length === 0) {
    logWarn("[sendEmailCommon] No valid recipients", logCtx({
      function_name: "sendTemplateEmail",
      extra: { templateCode, to },
    }));
    return { success: false };
  }

  const replyToList = (Array.isArray(replyTo) ? replyTo : replyTo ? [replyTo] : [])
    .map((e) => (typeof e === "string" ? e.trim() : String(e?.email || e).trim()))
    .filter(Boolean);

  try {
    const subject = getSubject(locale, templateCode, variables);
    const html = getHtml(locale, templateCode, variables);
    const from = `${FROM_NAME} <${FROM_EMAIL}>`;

    const payload = {
      from,
      to: normalizedTo,
      subject,
      html,
    };
    // Resend Node SDK uses camelCase `replyTo` (different from REST's reply_to — snake_case is ignored).
    if (replyToList.length === 1) {
      payload.replyTo = replyToList[0];
    } else if (replyToList.length > 1) {
      payload.replyTo = replyToList;
    }

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      throw resendErrorToError(error);
    }

    logInfo("[sendEmailCommon] Email sent (Resend)", logCtx({
      function_name: "sendTemplateEmail",
      extra: {
        templateCode,
        to: normalizedTo,
        reply_to: replyToList.length ? replyToList : undefined,
        messageId: data?.id,
      },
    }));
    return { success: true, messageId: data?.id };
  } catch (err) {
    logAndCaptureError(err, "[sendEmailCommon] Template email failed", logCtx({
      function_name: "sendTemplateEmail",
      extra: {
        templateCode,
        to: normalizedTo,
        message: err?.message,
        code: err?.code,
      },
    }));
    throw err;
  }
}

module.exports = {
  sendTemplateEmail,
  FROM_EMAIL,
  FROM_NAME,
};