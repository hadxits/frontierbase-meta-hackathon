/**
 * ============================================================================
 * sendEmailCommon.js - 공통 이메일 전송 (Resend API)
 * ============================================================================
 * - 회원가입 웰컴, 데이터셋 ready 등 템플릿 메일 전송.
 * - RESEND_API_KEY, Resend에서 검증된 발신 주소(EMAIL_USER) 필요.
 * ============================================================================
 */
const { Resend } = require("resend");
const environment = require("@/env");
const { getSubject, getHtml } = require("@/utils/emailTemplates");
const { logInfo, logWarn, logAndCaptureError } = require("@/utils/logger");

const FROM_EMAIL = environment.EMAIL_USER || "service@frontierbase.io";
const FROM_NAME = environment.EMAIL_FROM_NAME || "FrontierBase Team";

/** 로거/Sentry 컨벤션용. 메일 전송은 테넌트와 무관 (health 등과 동일하게 system). */
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
 * 템플릿 코드로 이메일 전송 (locale 기반 다국어)
 * @param {Object} options
 * @param {string} options.templateCode - 이메일 템플릿 코드 (예: "welcome", "dataset_ready", "dataset_deletion")
 * @param {string|string[]} options.to - 수신 이메일 (문자열 또는 배열)
 * @param {string} [options.locale="en"] - locale (기본값 en)
 * @param {Object} [options.variables={}] - 템플릿 변수 (예: displayName, datasetName, sender, channelName, inviteUrl, senderPhotoUrl, ctaButtonColor)
 * @param {string|string[]} [options.replyTo] - Reply-To (Resend reply_to). 수신자가 답장하면 From 대신 이 주소로 향함
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
    // Resend Node SDK는 camelCase `replyTo` (REST의 reply_to와 다름 — snake_case면 무시됨)
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