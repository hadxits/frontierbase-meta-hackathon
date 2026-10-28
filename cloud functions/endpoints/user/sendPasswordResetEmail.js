/**
 * ============================================================================
 * sendPasswordResetEmail.js - API to send multilingual password reset emails.
 * ============================================================================
 * - Use Resend + locale-based custom email instead of Firebase default reset template.
 * - Generate reset link with Admin SDK and send with password_reset template.
 * - Do not send email and respond sent:false if account does not exist or is disabled (deleted).
 * - Called before login (no requireCredential).
 * ============================================================================
 */
const crypto = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");

const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const Collection = require("@/const/firestore/Collection");
const ApiError = require("@/errors/apiError");
const { auth, store } = require("@/firebase");
const { detectLanguageFromLocale } = require("@/utils/localization");
const { TEMPLATE_CODES } = require("@/utils/emailTemplates");
const { sendTemplateEmail } = require("@/utils/sendEmailCommon");
const { applyLocaleToPasswordResetLink } = require("@/utils/passwordResetLink");

const EMAIL_MAX_LENGTH = 320;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORTED_LOCALES = ["en", "ko", "ja", "de", "fr", "it", "zh", "es"];
const DEFAULT_LOCALE = "en";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const RATE_LIMIT_POLICIES = [
  {
    key: "fifteen_minutes",
    windowMs: 15 * MINUTE_MS,
    limit: 3,
    blockMs: 15 * MINUTE_MS,
  },
  {
    key: "one_day",
    windowMs: DAY_MS,
    limit: 8,
    blockMs: DAY_MS,
  },
];

const MESSAGES = {
  invalidEmail: {
    ko: "유효한 이메일 주소를 입력해 주세요.",
    en: "Enter a valid email address.",
    ja: "有効なメールアドレスを入力してください。",
    de: "Geben Sie eine gültige E-Mail-Adresse ein.",
    fr: "Saisissez une adresse e-mail valide.",
    it: "Inserisci un indirizzo email valido.",
    zh: "請輸入有效的電子郵件地址。",
    es: "Introduce una dirección de correo válida.",
  },
  blocked: {
    ko: (waitText) =>
      `비밀번호 재설정 요청이 너무 많습니다. ${waitText} 후 다시 시도해 주세요.`,
    en: (waitText) =>
      `Too many password reset requests. Try again in ${waitText}.`,
    ja: (waitText) =>
      `パスワード再設定のリクエストが多すぎます。${waitText}後にもう一度お試しください。`,
    de: (waitText) =>
      `Zu viele Anfragen zum Zurücksetzen des Passworts. Versuchen Sie es in ${waitText} erneut.`,
    fr: (waitText) =>
      `Trop de demandes de réinitialisation. Réessayez dans ${waitText}.`,
    it: (waitText) =>
      `Troppe richieste di reimpostazione password. Riprova tra ${waitText}.`,
    zh: (waitText) =>
      `密碼重設請求過多，請在 ${waitText} 後再試。`,
    es: (waitText) =>
      `Demasiadas solicitudes de restablecimiento. Vuelve a intentarlo en ${waitText}.`,
  },
  emailSendFailed: {
    ko: "이메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
    en: "We couldn't send the email. Please try again later.",
    ja: "メールを送信できませんでした。しばらくしてからもう一度お試しください。",
    de: "Die E-Mail konnte nicht gesendet werden. Bitte versuchen Sie es später erneut.",
    fr: "Impossible d’envoyer l’e-mail. Veuillez réessayer plus tard.",
    it: "Impossibile inviare l’email. Riprova più tardi.",
    zh: "無法寄送郵件，請稍後再試。",
    es: "No se pudo enviar el correo. Inténtalo de nuevo más tarde.",
  },
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeLocale(locale) {
  const lang = detectLanguageFromLocale(String(locale || "").trim() || DEFAULT_LOCALE);
  return SUPPORTED_LOCALES.includes(lang) ? lang : DEFAULT_LOCALE;
}

function hashEmail(email) {
  return crypto.createHash("sha256").update(email).digest("hex");
}

function getMessage(locale, key) {
  return MESSAGES[key]?.[locale] || MESSAGES[key]?.[DEFAULT_LOCALE];
}

function getNumber(value, defaultValue = 0) {
  return Number.isFinite(value) ? value : defaultValue;
}

function formatWaitTime(locale, retryAfterMinutes) {
  const safeMinutes = Math.max(1, retryAfterMinutes);
  const hours = Math.ceil(safeMinutes / 60);

  if (safeMinutes >= 60) {
    const hourLabels = {
      ko: `${hours}시간`,
      en: `${hours} ${hours === 1 ? "hour" : "hours"}`,
      ja: `${hours}時間`,
      de: `${hours} ${hours === 1 ? "Stunde" : "Stunden"}`,
      fr: `${hours} ${hours === 1 ? "heure" : "heures"}`,
      it: `${hours} ${hours === 1 ? "ora" : "ore"}`,
      zh: `${hours} 小時`,
      es: `${hours} ${hours === 1 ? "hora" : "horas"}`,
    };
    return hourLabels[locale] || hourLabels.en;
  }

  const minuteLabels = {
    ko: `${safeMinutes}분`,
    en: `${safeMinutes} ${safeMinutes === 1 ? "minute" : "minutes"}`,
    ja: `${safeMinutes}分`,
    de: `${safeMinutes} ${safeMinutes === 1 ? "Minute" : "Minuten"}`,
    fr: `${safeMinutes} ${safeMinutes === 1 ? "minute" : "minutes"}`,
    it: `${safeMinutes} ${safeMinutes === 1 ? "minuto" : "minuti"}`,
    zh: `${safeMinutes} 分鐘`,
    es: `${safeMinutes} ${safeMinutes === 1 ? "minuto" : "minutos"}`,
  };
  return minuteLabels[locale] || minuteLabels.en;
}

function validateEmail(email, locale) {
  if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new ApiError({
      errorCode: "INVALID_EMAIL",
      message: getMessage(locale, "invalidEmail"),
      httpStatusCode: 400,
      returnToUser: true,
    });
  }
}

function updateWindow(currentWindow, policy, nowMs) {
  const startedAtMs = getNumber(currentWindow?.started_at_ms);
  const count = getNumber(currentWindow?.count);
  const shouldReset = !startedAtMs || nowMs - startedAtMs >= policy.windowMs;

  if (shouldReset) {
    return {
      count: 1,
      started_at_ms: nowMs,
      ends_at_ms: nowMs + policy.windowMs,
    };
  }

  return {
    count: count + 1,
    started_at_ms: startedAtMs,
    ends_at_ms: startedAtMs + policy.windowMs,
  };
}

function pickTriggeredPolicy(attempts) {
  return RATE_LIMIT_POLICIES.reduce((selected, policy) => {
    const count = getNumber(attempts?.[policy.key]?.count);
    if (count <= policy.limit) {
      return selected;
    }
    if (!selected || policy.blockMs > selected.blockMs) {
      return policy;
    }
    return selected;
  }, null);
}

async function assertNotRateLimited(email, locale) {
  const nowMs = Date.now();
  const docRef = store
    .collection(Collection.PASSWORD_RESET_RATE_LIMITS)
    .doc(hashEmail(email));

  return store.runTransaction(async (tx) => {
    const snapshot = await tx.get(docRef);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    const blockedUntilMs = getNumber(data.blocked_until_ms);

    if (blockedUntilMs > nowMs) {
      const retryAfterMinutes = Math.max(
        1,
        Math.ceil((blockedUntilMs - nowMs) / MINUTE_MS)
      );
      const messageBuilder = getMessage(locale, "blocked");
      throw new ApiError({
        errorCode: "RATE_LIMITED",
        message: messageBuilder(formatWaitTime(locale, retryAfterMinutes)),
        httpStatusCode: 429,
        returnToUser: true,
      });
    }

    const attempts = { ...(data.attempts || {}) };
    for (const policy of RATE_LIMIT_POLICIES) {
      attempts[policy.key] = updateWindow(attempts[policy.key], policy, nowMs);
    }

    const triggered = pickTriggeredPolicy(attempts);
    if (triggered) {
      const blocked_until_ms = nowMs + triggered.blockMs;
      tx.set(
        docRef,
        {
          attempts,
          blocked_until_ms,
          block_policy_key: triggered.key,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      const messageBuilder = getMessage(locale, "blocked");
      throw new ApiError({
        errorCode: "RATE_LIMITED",
        message: messageBuilder(
          formatWaitTime(locale, Math.ceil(triggered.blockMs / MINUTE_MS))
        ),
        httpStatusCode: 429,
        returnToUser: true,
      });
    }

    tx.set(
      docRef,
      {
        attempts,
        blocked_until_ms: 0,
        block_policy_key: null,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

async function generateResetLink(email, locale) {
  // Same as Firebase Console default reset email: generated without actionCodeSettings(continueUrl).
  const firebaseLink = await auth.generatePasswordResetLink(email);
  return applyLocaleToPasswordResetLink(firebaseLink, locale);
}

/** Do not send reset email to non-existent or disabled (deleted) accounts. */
async function canSendPasswordReset(email) {
  try {
    const user = await auth.getUserByEmail(email);
    return !user.disabled;
  } catch (err) {
    if (err?.code === "auth/user-not-found") {
      return false;
    }
    throw err;
  }
}

const sendPasswordResetEmail = _onRequest({
  opts: {
    memory: "512MiB",
    cpu: "gcf_gen1",
    maxInstances: 3,
    concurrency: 1
  },
  params: {
    type: PropertyType.OBJECT,
    properties: {
      email: { type: PropertyType.STRING, minLength: 1, maxLength: EMAIL_MAX_LENGTH },
      locale: { type: PropertyType.STRING, maxLength: 16 },
    },
    required: ["email"],
    additionalProperties: false,
  },
  handler: async (req) => {
    const locale = normalizeLocale(req.body.locale);
    const email = normalizeEmail(req.body.email);
    validateEmail(email, locale);
    await assertNotRateLimited(email, locale);

    const eligible = await canSendPasswordReset(email);
    if (!eligible) {
      return { sent: false };
    }

    const resetUrl = await generateResetLink(email, locale);
    const result = await sendTemplateEmail({
      templateCode: TEMPLATE_CODES.PASSWORD_RESET,
      to: email,
      locale,
      variables: { email, resetUrl },
    });

    if (!result.success) {
      throw new ApiError({
        errorCode: "EMAIL_SEND_FAILED",
        message: getMessage(locale, "emailSendFailed"),
        httpStatusCode: 502,
        returnToUser: true,
      });
    }

    return { sent: true, messageId: result.messageId };
  },
});

module.exports = sendPasswordResetEmail;