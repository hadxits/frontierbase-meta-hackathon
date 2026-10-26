/** 이메일 OTP 로그인 공통 기본값 (의존성 없음 — circular require 방지) */
const EMAIL_OTP_DEFAULTS = {
  TTL_MS: 10 * 60 * 1000,
  CODE_LENGTH: 6,
  MAX_VERIFY_ATTEMPTS: 5,
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  RATE_LIMIT_MAX_SENDS: 5
};

module.exports = { EMAIL_OTP_DEFAULTS };