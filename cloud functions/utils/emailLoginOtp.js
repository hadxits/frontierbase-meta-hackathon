const crypto = require("crypto");
const environment = require("@/env");
const { EMAIL_OTP_DEFAULTS } = require("@/const/emailOtpDefaults");
const { Resend } = require("resend");
const { logWarn, logInfo } = require("@/utils/logger");
const { getEmailLoginOtpMail } = require("@/utils/emailTemplates");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashEmail(email) {
  return crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

function buildOtpDocId(purposeKey, email) {
  return `${purposeKey}:${hashEmail(email)}`;
}

function otpPepper() {
  return String(
    environment.ENCRYPTION_KEY || environment.EMAIL_OTP_PEPPER || "fb-email-otp"
  );
}

function hashOtpCode(purposeKey, email, code) {
  return crypto
    .createHash("sha256")
    .update(`${otpPepper()}:${purposeKey}:${normalizeEmail(email)}:${String(code).trim()}`)
    .digest("hex");
}

function generateOtpCode(length = EMAIL_OTP_DEFAULTS.CODE_LENGTH) {
  const digits = Math.max(4, Math.min(8, Number(length) || EMAIL_OTP_DEFAULTS.CODE_LENGTH));
  const min = 10 ** (digits - 1);
  const max = 10 ** digits;
  return String(crypto.randomInt(min, max));
}

function buildOtpEmailContent({ code, locale, purposeConfig }) {
  const ttlMin = Math.floor(EMAIL_OTP_DEFAULTS.TTL_MS / 60000);
  return getEmailLoginOtpMail({
    locale: locale || "en",
    code,
    purposeKey: purposeConfig?.key,
    ttlMin,
  });
}

async function sendOtpEmail({ to, code, locale, purposeConfig }) {
  const key = environment.RESEND_API_KEY && String(environment.RESEND_API_KEY).trim();
  if (!key) {
    logWarn("[emailLoginOtp] RESEND_API_KEY missing", {
      tenant_id: "system",
      function_name: "sendOtpEmail"
    });
    throw new Error("RESEND_API_KEY is not configured");
  }

  const from = environment.EMAIL_USER || "service@frontierbase.io";
  const fromName = environment.EMAIL_FROM_NAME || "FrontierBase Team";
  const { subject, html } = buildOtpEmailContent({ code, locale, purposeConfig });
  const resend = new Resend(key);

  const result = await resend.emails.send({
    from: `${fromName} <${from}>`,
    to: [to],
    subject,
    html
  });

  if (result.error) {
    throw new Error(result.error.message || "Resend send failed");
  }

  logInfo("[emailLoginOtp] OTP email sent", {
    tenant_id: "system",
    function_name: "sendOtpEmail",
    extra: { to, messageId: result.data?.id, purpose: purposeConfig?.key || null }
  });

  return { success: true, messageId: result.data?.id };
}

function validateEmailFormat(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 320 || !EMAIL_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function otpDocPayload({ purposeKey, email, code }) {
  const now = Date.now();
  return {
    purpose: purposeKey,
    email: normalizeEmail(email),
    code_hash: hashOtpCode(purposeKey, email, code),
    created_at: now,
    expires_at: now + EMAIL_OTP_DEFAULTS.TTL_MS,
    attempts: 0,
    max_attempts: EMAIL_OTP_DEFAULTS.MAX_VERIFY_ATTEMPTS
  };
}

function verifyOtpAgainstDoc({ purposeKey, email, code, doc }) {
  if (!doc) return { ok: false, reason: "not_found" };
  if (String(doc.purpose || "") !== String(purposeKey || "")) {
    return { ok: false, reason: "not_found" };
  }
  const now = Date.now();
  if (now > Number(doc.expires_at || 0)) return { ok: false, reason: "expired" };
  if (
    Number(doc.attempts || 0) >=
    Number(doc.max_attempts || EMAIL_OTP_DEFAULTS.MAX_VERIFY_ATTEMPTS)
  ) {
    return { ok: false, reason: "locked" };
  }
  const expected = hashOtpCode(purposeKey, email, code);
  if (expected !== doc.code_hash) return { ok: false, reason: "invalid" };
  return { ok: true };
}

async function isEmailAllowedForPurpose(email, purposeConfig) {
  if (!purposeConfig) return false;
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  if (typeof purposeConfig.allowEmail === "function") {
    return !!(await purposeConfig.allowEmail(normalized, purposeConfig));
  }

  if (purposeConfig.allowEmails instanceof Set) {
    return purposeConfig.allowEmails.has(normalized);
  }

  if (Array.isArray(purposeConfig.allowEmails)) {
    return purposeConfig.allowEmails.map(normalizeEmail).includes(normalized);
  }

  return false;
}

module.exports = {
  EMAIL_OTP_DEFAULTS,
  normalizeEmail,
  hashEmail,
  buildOtpDocId,
  hashOtpCode,
  generateOtpCode,
  sendOtpEmail,
  validateEmailFormat,
  otpDocPayload,
  verifyOtpAgainstDoc,
  isEmailAllowedForPurpose
};