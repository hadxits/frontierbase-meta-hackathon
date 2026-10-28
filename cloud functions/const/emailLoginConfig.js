const { EMAIL_OTP_DEFAULTS } = require("@/const/emailOtpDefaults");
const { isEmailOtpEnabledForEmail } = require("@/utils/rtdbUser");

/**
 * Email OTP login settings by purpose.
 * - allowEmails: allowed email set (exact match, lowercase)
 * - allowEmail: (email) => boolean | Promise<boolean> — dynamic allow (overrides allowEmails)
 * - maskUnauthorizedOnSend: return sent:true even for unauthorized emails (prevents enumeration)
 * - requireAuthUser: require existing Firebase Auth user on successful verification
 * - customTokenClaims: additional claims for createCustomToken
 * (Service name in email subject/body refers to emailTemplateBundles email_login_otp strings)
 */
const EMAIL_LOGIN_PURPOSES = {
  admin: {
    cors: [
      "http://localhost:9082",
      "https://frontierbase-admin.web.app",
      "https://frontierbase-admin.firebaseapp.com"
    ],
    allowEmails: new Set(["david@frontierbase.io"]),
    maskUnauthorizedOnSend: true,
    requireAuthUser: true,
    customTokenClaims: { fb_role: "admin" }
  },
  console: {
    cors: [
      "https://frontierbase-console.web.app",
      "https://frontierbase-console.firebaseapp.com",
      "https://frontierbase-admin.web.app",
      "https://frontierbase-admin.firebaseapp.com",
      "https://console.frontierbase.io",
      "http://localhost:9081"
    ],
    allowEmail: isEmailOtpEnabledForEmail,
    maskUnauthorizedOnSend: true,
    requireAuthUser: false
  }
};

function normalizePurposeKey(purpose) {
  return String(purpose || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function resolveEmailLoginPurpose(purpose) {
  const key = normalizePurposeKey(purpose);
  if (!key || !EMAIL_LOGIN_PURPOSES[key]) return null;
  return { key, ...EMAIL_LOGIN_PURPOSES[key] };
}

function getAllEmailLoginCorsOrigins() {
  const origins = new Set();
  for (const config of Object.values(EMAIL_LOGIN_PURPOSES)) {
    for (const origin of config.cors || []) {
      if (origin) origins.add(origin);
    }
  }
  return [...origins];
}

module.exports = {
  EMAIL_OTP_DEFAULTS,
  EMAIL_LOGIN_PURPOSES,
  normalizePurposeKey,
  resolveEmailLoginPurpose,
  getAllEmailLoginCorsOrigins
};