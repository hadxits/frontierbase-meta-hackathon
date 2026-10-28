/**
 * Replace email {{placeholder}} and select locale row.
 * Original markup and phrases are in the emailTemplateBundles.js variable (bundle).
 */
const { EMAIL_TEMPLATE_BUNDLES } = require("@/utils/emailTemplateBundles");

function loadBodyHtml(templateId) {
  const b = EMAIL_TEMPLATE_BUNDLES[templateId];
  if (!b || typeof b.bodyHtml !== "string") {
    throw new Error(`Unknown email template: ${templateId}`);
  }
  return b.bodyHtml.trim();
}

function loadStrings(templateId) {
  const b = EMAIL_TEMPLATE_BUNDLES[templateId];
  if (!b || typeof b.strings !== "object" || !b.strings) {
    throw new Error(`Unknown email template strings: ${templateId}`);
  }
  return b.strings;
}

/**
 * @param {string} template HTML or phrase string
 * @param {Record<string, string|number|undefined|null>} data
 */
function interpolate(template, data) {
  if (typeof template !== "string") return "";
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = data[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** `**text**` → <strong> for email (e.g., welcome) */
function markdownBoldToEmailStrong(s) {
  return s.replace(/\*\*(.*?)\*\*/g, `<strong style="color:#ffffff">$1</strong>`);
}

/** Line breaks (`\n`) in bundle phrases → email HTML `<br />` (no `<br>` tags in bundle) */
function newlineToEmailBr(s) {
  return String(s ?? "").replace(/\r?\n/g, "<br />");
}

function stringsForLang(bundle, lang, fallbackLang = "en") {
  const row = bundle[lang] || bundle[fallbackLang];
  if (!row) {
    throw new Error(`email strings: missing locale "${fallbackLang}" in template bundle`);
  }
  return row;
}

module.exports = {
  loadBodyHtml,
  loadStrings,
  interpolate,
  markdownBoldToEmailStrong,
  newlineToEmailBr,
  stringsForLang,
};