const { detectLanguageFromLocale } = require("@/utils/localization");

/**
 * Apply only locale lang to Admin SDK generatePasswordResetLink result.
 * Do not include continueUrl to match Firebase Console default email.
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