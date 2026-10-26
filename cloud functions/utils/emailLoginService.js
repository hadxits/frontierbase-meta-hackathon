const ApiError = require("@/errors/apiError");
const Collection = require("@/const/firestore/Collection");
const { auth, store } = require("@/firebase");
const { EMAIL_OTP_DEFAULTS } = require("@/const/emailOtpDefaults");
const {
  resolveEmailLoginPurpose
} = require("@/const/emailLoginConfig");
const {
  buildOtpDocId,
  generateOtpCode,
  sendOtpEmail,
  validateEmailFormat,
  otpDocPayload,
  verifyOtpAgainstDoc,
  isEmailAllowedForPurpose
} = require("@/utils/emailLoginOtp");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logWarn, logAndCaptureError } = require("@/utils/logger");

const GENERIC_SEND_OK = {
  sent: true,
  expiresInSec: Math.floor(EMAIL_OTP_DEFAULTS.TTL_MS / 1000)
};

const VERIFY_ERROR_TYPES = {
  expired: "EMAIL_LOGIN_OTP_EXPIRED",
  locked: "EMAIL_LOGIN_OTP_LOCKED",
  invalid: "EMAIL_LOGIN_OTP_INVALID"
};

function otpErrorMessage(locale, errorType, replacements = {}) {
  let message = getLocalizedErrorMessage(locale || "en", errorType);
  for (const [key, value] of Object.entries(replacements)) {
    message = message.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
  }
  return message;
}

function resolvePurposeOrThrow(purpose, locale) {
  const purposeConfig = resolveEmailLoginPurpose(purpose);
  if (!purposeConfig) {
    throw new ApiError({
      errorCode: "INVALID_PURPOSE",
      message: otpErrorMessage(locale, "EMAIL_LOGIN_INVALID_PURPOSE"),
      httpStatusCode: 400,
      returnToUser: true
    });
  }
  return purposeConfig;
}

async function checkSendRateLimit(purposeKey, email, locale) {
  const docId = buildOtpDocId(purposeKey, email);
  const ref = store.collection(Collection.EMAIL_LOGIN_RATE_LIMITS).doc(docId);
  const snap = await ref.get();
  const now = Date.now();
  const data = snap.exists ? snap.data() : {};
  const windowStart = Number(data.window_start_ms || 0);
  const count = Number(data.count || 0);
  const windowMs = EMAIL_OTP_DEFAULTS.RATE_LIMIT_WINDOW_MS;
  const maxSends = EMAIL_OTP_DEFAULTS.RATE_LIMIT_MAX_SENDS;

  if (now - windowStart < windowMs && count >= maxSends) {
    throw new ApiError({
      errorCode: "RATE_LIMITED",
      message: otpErrorMessage(locale, "EMAIL_LOGIN_RATE_LIMITED"),
      httpStatusCode: 429,
      returnToUser: true
    });
  }

  const windowExpired = now - windowStart >= windowMs;
  await ref.set({
    purpose: purposeKey,
    count: windowExpired ? 1 : count + 1,
    window_start_ms: windowExpired ? now : windowStart || now,
    updated_at: now
  });
}

async function sendEmailLoginCodeRequest({ purpose, email, locale, functionName }) {
  const resolvedLocale = locale || "en";
  const purposeConfig = resolvePurposeOrThrow(purpose, resolvedLocale);
  const normalizedEmail = validateEmailFormat(email);

  if (!normalizedEmail) {
    throw new ApiError({
      errorCode: "INVALID_EMAIL",
      message: otpErrorMessage(resolvedLocale, "EMAIL_LOGIN_INVALID_EMAIL"),
      httpStatusCode: 400,
      returnToUser: true
    });
  }

  const allowed = await isEmailAllowedForPurpose(normalizedEmail, purposeConfig);
  if (!allowed) {
    if (purposeConfig.maskUnauthorizedOnSend === false) {
      throw new ApiError({
        errorCode: "FORBIDDEN",
        message: otpErrorMessage(resolvedLocale, "EMAIL_LOGIN_FORBIDDEN"),
        httpStatusCode: 403,
        returnToUser: true
      });
    }
    return GENERIC_SEND_OK;
  }

  await checkSendRateLimit(purposeConfig.key, normalizedEmail, resolvedLocale);

  const code = generateOtpCode();
  const otpRef = store
    .collection(Collection.EMAIL_LOGIN_OTP)
    .doc(buildOtpDocId(purposeConfig.key, normalizedEmail));

  try {
    await sendOtpEmail({
      to: normalizedEmail,
      code,
      locale: resolvedLocale,
      purposeConfig
    });
  } catch (err) {
    logWarn("[emailLoginService] email send failed", {
      tenant_id: "system",
      function_name: functionName || "sendEmailLoginCode",
      extra: { error: err?.message, purpose: purposeConfig.key }
    });
    logAndCaptureError(
      err instanceof Error ? err : new Error(String(err)),
      "[emailLoginService] email send failed",
      {
        tenant_id: "system",
        function_name: functionName || "sendEmailLoginCode",
        extra: { purpose: purposeConfig.key }
      }
    );
    throw new ApiError({
      errorCode: "EMAIL_SEND_FAILED",
      message: otpErrorMessage(resolvedLocale, "EMAIL_LOGIN_EMAIL_SEND_FAILED"),
      httpStatusCode: 502,
      returnToUser: true
    });
  }

  await otpRef.set(
    otpDocPayload({
      purposeKey: purposeConfig.key,
      email: normalizedEmail,
      code
    })
  );

  return GENERIC_SEND_OK;
}

async function verifyEmailLoginCodeRequest({ purpose, email, code, locale }) {
  const resolvedLocale = locale || "en";
  const purposeConfig = resolvePurposeOrThrow(purpose, resolvedLocale);
  const normalizedEmail = validateEmailFormat(email);
  const normalizedCode = String(code || "").trim();
  const codePattern = new RegExp(`^\\d{${EMAIL_OTP_DEFAULTS.CODE_LENGTH}}$`);

  if (!normalizedEmail) {
    throw new ApiError({
      errorCode: "INVALID_EMAIL",
      message: otpErrorMessage(resolvedLocale, "EMAIL_LOGIN_INVALID_EMAIL"),
      httpStatusCode: 400,
      returnToUser: true
    });
  }

  if (!codePattern.test(normalizedCode)) {
    throw new ApiError({
      errorCode: "INVALID_CODE",
      message: otpErrorMessage(resolvedLocale, "EMAIL_LOGIN_INVALID_CODE_FORMAT", {
        digits: EMAIL_OTP_DEFAULTS.CODE_LENGTH
      }),
      httpStatusCode: 400,
      returnToUser: true
    });
  }

  const allowed = await isEmailAllowedForPurpose(normalizedEmail, purposeConfig);
  if (!allowed) {
    throw new ApiError({
      errorCode: "FORBIDDEN",
      message: otpErrorMessage(resolvedLocale, "EMAIL_LOGIN_FORBIDDEN"),
      httpStatusCode: 403,
      returnToUser: true
    });
  }

  const otpRef = store
    .collection(Collection.EMAIL_LOGIN_OTP)
    .doc(buildOtpDocId(purposeConfig.key, normalizedEmail));
  const snap = await otpRef.get();

  if (!snap.exists) {
    throw new ApiError({
      errorCode: "INVALID_CODE",
      message: otpErrorMessage(resolvedLocale, "EMAIL_LOGIN_OTP_NOT_FOUND"),
      httpStatusCode: 400,
      returnToUser: true
    });
  }

  const doc = snap.data();
  const verdict = verifyOtpAgainstDoc({
    purposeKey: purposeConfig.key,
    email: normalizedEmail,
    code: normalizedCode,
    doc
  });

  if (!verdict.ok) {
    await otpRef.update({
      attempts: Number(doc.attempts || 0) + 1,
      updated_at: Date.now()
    });
    const errorType =
      VERIFY_ERROR_TYPES[verdict.reason] || VERIFY_ERROR_TYPES.invalid;
    throw new ApiError({
      errorCode: "INVALID_CODE",
      message: otpErrorMessage(resolvedLocale, errorType),
      httpStatusCode: 400,
      returnToUser: true
    });
  }

  await otpRef.delete();

  if (purposeConfig.requireAuthUser === false) {
    return { verified: true };
  }

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(normalizedEmail);
  } catch {
    throw new ApiError({
      errorCode: "AUTH_USER_NOT_FOUND",
      message: otpErrorMessage(resolvedLocale, "EMAIL_LOGIN_AUTH_USER_NOT_FOUND"),
      httpStatusCode: 404,
      returnToUser: true
    });
  }

  const claims =
    purposeConfig.customTokenClaims &&
    typeof purposeConfig.customTokenClaims === "object"
      ? purposeConfig.customTokenClaims
      : undefined;
  const customToken = await auth.createCustomToken(userRecord.uid, claims);

  return { customToken, purpose: purposeConfig.key };
}

module.exports = {
  sendEmailLoginCodeRequest,
  verifyEmailLoginCodeRequest
};