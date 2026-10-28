/** Common default for email OTP login (no dependencies — prevents circular require) */
const EMAIL_OTP_DEFAULTS = {
  TTL_MS: 10 * 60 * 1000,
  CODE_LENGTH: 6,
  MAX_VERIFY_ATTEMPTS: 5,
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  RATE_LIMIT_MAX_SENDS: 5
};

module.exports = { EMAIL_OTP_DEFAULTS };