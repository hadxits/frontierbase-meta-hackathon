const { detectLanguageFromLocale } = require("@/utils/localization");

/**
 * Admin SDK generatePasswordResetLink 결과에 locale lang만 반영합니다.
 * Firebase Console 기본 메일과 동일하게 continueUrl 은 넣지 않습니다.
 *
 * @param {string} firebaseLink
 * @param {string} [locale="en"]
 * @returns {string}
 */
function applyLocaleToPasswordResetLink(firebaseLink, locale = "en") {
  const raw = String(firebaseLink || "").trim();
  if (!raw) return "";

  const url = new URL(raw);
  const lang = detectLanguageFromLocale(locale) || "en";
  url.searchParams.set("lang", lang);
  return url.toString();
}

/** @deprecated use applyLocaleToPasswordResetLink */
const toConsolePasswordResetLink = applyLocaleToPasswordResetLink;

module.exports = {
  applyLocaleToPasswordResetLink,
  toConsolePasswordResetLink,
};