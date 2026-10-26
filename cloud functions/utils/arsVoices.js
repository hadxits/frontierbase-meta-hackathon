/**
 * ElevenLabs voice_id by content language (operator-chosen IDs).
 * Product UI locales use zh-TW only; content detection may emit "zh".
 * Both map to the same Chinese voice.
 */
const DEFAULT_VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2"; // en

/** @type {Record<string, string>} */
const VOICE_BY_LANG = {
  ko: "aiUUgjHa4mpHf6UenZuf", // Mina - Clear, Calm & Warm
  en: "Xb7hH8MSUJpSbSDYk0k2",
  ja: "qbfQuoRJv1T3ei3qV4bc",
  de: "MGG5Irb57ATHvyIeTEYo",
  fr: "HuLbOdhRlvQQN8oPP0AJ",
  it: "UnOINkXZ3yK4vVg3Iayj",
  es: "f18RlRJGEw0TaGYwmk8B",
  // One Chinese voice; zh-TW is the product locale, zh is detectContentLang / legacy.
  zh: "kbrsaic1zriFXx1pgRYN",
  "zh-TW": "kbrsaic1zriFXx1pgRYN"
};

const ELEVEN_MODEL = "eleven_multilingual_v2";

/**
 * @param {string} contentLang - e.g. ko, en, zh-TW
 */
function resolveArsVoiceId(contentLang) {
  const lang = String(contentLang || "en").trim() || "en";
  const base = lang.split("-")[0].toLowerCase();
  return VOICE_BY_LANG[lang] || VOICE_BY_LANG[base] || DEFAULT_VOICE_ID;
}

/**
 * Heuristic content language from text (not browser locale).
 * Chinese → "zh" (same voice as zh-TW).
 */
function detectContentLang(text) {
  const s = String(text || "");
  if (/[\uac00-\ud7af]/.test(s)) return "ko";
  if (/[\u3040-\u30ff]/.test(s)) return "ja";
  if (/[\u4e00-\u9fff]/.test(s)) return "zh";
  if (/[äöüß]/i.test(s)) return "de";
  if (/[àâçéèêëïîôùûü]/i.test(s)) return "fr";
  if (/[áéíóúñ¿¡]/i.test(s)) return "es";
  return "en";
}

module.exports = {
  ELEVEN_MODEL,
  resolveArsVoiceId,
  detectContentLang
};
