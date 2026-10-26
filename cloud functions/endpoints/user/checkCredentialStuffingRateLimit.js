const crypto = require("crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const Collection = require("@/const/firestore/Collection");
const ApiError = require("@/errors/apiError");
const { store } = require("@/firebase");

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const RATE_LIMIT_POLICIES = [
  {
    key: "one_minute",
    windowMs: MINUTE_MS,
    limit: 2,
    blockMs: MINUTE_MS,
    lockType: "temporary"
  },
  {
    key: "ten_minutes",
    windowMs: 10 * MINUTE_MS,
    limit: 4,
    blockMs: 10 * MINUTE_MS,
    lockType: "temporary"
  },
  {
    key: "one_hour",
    windowMs: HOUR_MS,
    limit: 9,
    blockMs: HOUR_MS,
    lockType: "temporary"
  },
  {
    key: "one_day",
    windowMs: DAY_MS,
    limit: 14,
    blockMs: DAY_MS,
    lockType: "temporary"
  }
];

const EMAIL_MAX_LENGTH = 320;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_LOCALE = "en";
const SUPPORTED_LOCALES = ["ko", "en", "ja", "de", "fr", "it", "zh", "es"];
const ACTION = {
  CHECK: "check",
  FAILURE: "failure"
};

const MESSAGES = {
  checkAllowed: {
    ko: "로그인을 시도할 수 있습니다.",
    en: "You can try signing in.",
    ja: "ログインをお試しいただけます。",
    de: "Sie können versuchen, sich anzumelden.",
    fr: "Vous pouvez essayer de vous connecter.",
    it: "Puoi provare ad accedere.",
    zh: "你可以嘗試登入。",
    es: "Puedes intentar iniciar sesión."
  },
  failureRecorded: {
    ko: "로그인 실패 기록이 반영되었습니다.",
    en: "Login failure recorded.",
    ja: "ログイン失敗を記録しました。",
    de: "Fehlgeschlagener Login wurde erfasst.",
    fr: "Échec de connexion enregistré.",
    it: "Tentativo di accesso non riuscito registrato.",
    zh: "已記錄登入失敗。",
    es: "Intento de inicio de sesión fallido registrado."
  },
  invalidEmail: {
    ko: "유효한 이메일 주소를 입력해 주세요.",
    en: "Enter a valid email address.",
    ja: "有効なメールアドレスを入力してください。",
    de: "Geben Sie eine gültige E-Mail-Adresse ein.",
    fr: "Saisissez une adresse e-mail valide.",
    it: "Inserisci un indirizzo email valido.",
    zh: "請輸入有效的電子郵件地址。",
    es: "Introduce una dirección de correo válida."
  },
  blocked: {
    ko: (waitText) =>
      `로그인 실패가 반복되어 잠시 제한되었습니다. ${waitText} 후 다시 시도해 주세요.`,
    en: (waitText) =>
      `Too many failed login attempts. Try again in ${waitText}.`,
    ja: (waitText) =>
      `ログイン失敗が続いたため、一時的に制限されています。${waitText}後にもう一度お試しください。`,
    de: (waitText) =>
      `Zu viele fehlgeschlagene Login-Versuche. Versuchen Sie es in ${waitText} erneut.`,
    fr: (waitText) =>
      `Trop de tentatives de connexion ont échoué. Réessayez dans ${waitText}.`,
    it: (waitText) =>
      `Troppi tentativi di accesso non riusciti. Riprova tra ${waitText}.`,
    zh: (waitText) =>
      `登入失敗次數過多，已暫時限制。請在 ${waitText} 後再試。`,
    es: (waitText) =>
      `Demasiados intentos de inicio de sesión fallidos. Vuelve a intentarlo en ${waitText}.`
  }
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeLocale(locale) {
  if (!locale) {
    return DEFAULT_LOCALE;
  }

  const normalized = String(locale).trim().toLowerCase().replace("_", "-");
  const language = normalized.split("-")[0];
  return SUPPORTED_LOCALES.includes(language) ? language : DEFAULT_LOCALE;
}

function hashEmail(email) {
  return crypto.createHash("sha256").update(email).digest("hex");
}

function getNumber(value, defaultValue = 0) {
  return Number.isFinite(value) ? value : defaultValue;
}

function getRetryAfterSeconds(blockedUntilMs, nowMs) {
  return Math.max(0, Math.ceil((blockedUntilMs - nowMs) / SECOND_MS));
}

function getRetryAfterMinutes(blockedUntilMs, nowMs) {
  return Math.max(0, Math.ceil((blockedUntilMs - nowMs) / MINUTE_MS));
}

function getMessage(locale, key) {
  return MESSAGES[key]?.[locale] || MESSAGES[key]?.[DEFAULT_LOCALE];
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
      es: `${hours} ${hours === 1 ? "hora" : "horas"}`
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
    es: `${safeMinutes} ${safeMinutes === 1 ? "minuto" : "minutos"}`
  };
  return minuteLabels[locale] || minuteLabels.en;
}

function formatDuration(locale, durationMs) {
  return formatWaitTime(locale, Math.ceil(durationMs / MINUTE_MS));
}

function buildSuccessResponse(locale, action) {
  return {
    status: "success",
    success: true,
    block: false,
    blocked: false,
    action,
    locale,
    retryAfterSeconds: 0,
    retryAfterMinutes: 0,
    lockType: null,
    message: getMessage(
      locale,
      action === ACTION.CHECK ? "checkAllowed" : "failureRecorded"
    )
  };
}

function buildBlockResponse({ blockedUntilMs, nowMs, policy, locale, action }) {
  const retryAfterSeconds = getRetryAfterSeconds(blockedUntilMs, nowMs);
  const retryAfterMinutes = getRetryAfterMinutes(blockedUntilMs, nowMs);
  const messageBuilder = getMessage(locale, "blocked");

  return {
    status: "block",
    success: false,
    block: true,
    blocked: true,
    action,
    locale,
    retryAfterSeconds,
    retryAfterMinutes,
    blockedUntilMs,
    lockType: policy?.lockType || "temporary",
    policy: policy
      ? {
          key: policy.key,
          window: formatDuration(locale, policy.windowMs),
          windowMs: policy.windowMs,
          limit: policy.limit
        }
      : null,
    message: messageBuilder(formatWaitTime(locale, retryAfterMinutes))
  };
}

function updateWindow(currentWindow, policy, nowMs) {
  const startedAtMs = getNumber(currentWindow?.started_at_ms);
  const count = getNumber(currentWindow?.count);
  const shouldReset = !startedAtMs || nowMs - startedAtMs >= policy.windowMs;

  if (shouldReset) {
    return {
      count: 1,
      started_at_ms: nowMs,
      ends_at_ms: nowMs + policy.windowMs
    };
  }

  return {
    count: count + 1,
    started_at_ms: startedAtMs,
    ends_at_ms: startedAtMs + policy.windowMs
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

function validateEmail(email, locale) {
  if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new ApiError({
      errorCode: "INVALID_EMAIL",
      message: getMessage(locale, "invalidEmail"),
      httpStatusCode: 400,
      returnToUser: true
    });
  }
}

function getBlockPolicy(policyKey) {
  return RATE_LIMIT_POLICIES.find((item) => item.key === policyKey) || null;
}

function buildActiveBlockResponse(data, nowMs, locale, action) {
  const blockedUntilMs = getNumber(data?.blocked_until_ms);
  if (blockedUntilMs <= nowMs) {
    return null;
  }

  return buildBlockResponse({
    blockedUntilMs,
    nowMs,
    policy: getBlockPolicy(data?.block_policy_key),
    locale,
    action
  });
}

const checkCredentialStuffingRateLimit = _onRequest({
  opts: {
    memory: "256MiB",
    maxInstances: 2,
    concurrency: 10
  },
  params: {
    type: PropertyType.OBJECT,
    properties: {
      email: { type: PropertyType.STRING, minLength: 1, maxLength: EMAIL_MAX_LENGTH },
      locale: { type: PropertyType.STRING, maxLength: 16 },
      action: { type: PropertyType.STRING, enum: [ACTION.CHECK, ACTION.FAILURE] }
    },
    required: ["email", "action"],
    additionalProperties: false
  },
  handler: async (req) => {
    const locale = normalizeLocale(req.body.locale);
    const action = req.body.action;
    const email = normalizeEmail(req.body.email);
    validateEmail(email, locale);

    const nowMs = Date.now();
    const emailHash = hashEmail(email);
    const docRef = store
      .collection(Collection.CREDENTIAL_STUFFING_RATE_LIMITS)
      .doc(emailHash);

    if (action === ACTION.CHECK) {
      const snapshot = await docRef.get();
      const activeBlockResponse = buildActiveBlockResponse(
        snapshot.exists ? snapshot.data() || {} : {},
        nowMs,
        locale,
        action
      );

      return activeBlockResponse || buildSuccessResponse(locale, action);
    }

    return store.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef);
      const data = snapshot.exists ? snapshot.data() || {} : {};
      const activeBlockResponse = buildActiveBlockResponse(
        data,
        nowMs,
        locale,
        action
      );

      if (activeBlockResponse) {
        transaction.set(
          docRef,
          {
            last_blocked_attempt_at_ms: nowMs,
            updated_at: FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        return activeBlockResponse;
      }

      const currentAttempts = data.attempts || {};
      const attempts = RATE_LIMIT_POLICIES.reduce((acc, policy) => {
        acc[policy.key] = updateWindow(currentAttempts[policy.key], policy, nowMs);
        return acc;
      }, {});

      const triggeredPolicy = pickTriggeredPolicy(attempts);
      const newBlockedUntilMs = triggeredPolicy
        ? nowMs + triggeredPolicy.blockMs
        : 0;

      transaction.set(
        docRef,
        {
          email_hash: emailHash,
          attempts,
          blocked_until_ms: newBlockedUntilMs,
          block_policy_key: triggeredPolicy?.key || null,
          last_attempt_at_ms: nowMs,
          expires_at: Timestamp.fromMillis(nowMs + DAY_MS * 2),
          updated_at: FieldValue.serverTimestamp(),
          created_at: data.created_at || FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      if (triggeredPolicy) {
        return buildBlockResponse({
          blockedUntilMs: newBlockedUntilMs,
          nowMs,
          policy: triggeredPolicy,
          locale,
          action
        });
      }

      return buildSuccessResponse(locale, action);
    });
  }
});

module.exports = checkCredentialStuffingRateLimit;