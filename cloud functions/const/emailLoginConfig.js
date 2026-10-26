const { EMAIL_OTP_DEFAULTS } = require("@/const/emailOtpDefaults");
const { isEmailOtpEnabledForEmail } = require("@/utils/rtdbUser");

/**
 * purpose별 이메일 OTP 로그인 설정.
 * - allowEmails: 허용 이메일 Set (정확 일치, lowercase)
 * - allowEmail: (email) => boolean | Promise<boolean> — 동적 허용 (allowEmails보다 우선)
 * - maskUnauthorizedOnSend: 미허용 이메일도 sent:true 반환 (열거 방지)
 * - requireAuthUser: 검증 성공 시 Firebase Auth 기존 사용자 필수
 * - customTokenClaims: createCustomToken 추가 claims
 * (메일 제목·본문의 서비스명은 emailTemplateBundles email_login_otp strings 참고)
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