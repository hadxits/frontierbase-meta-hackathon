/**
 * 이메일 {{placeholder}} 치환 및 locale 행 선택.
 * 마크업·문구 원본은 emailTemplateBundles.js 변수(번들)에 있습니다.
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
 * @param {string} template HTML 또는 문구 문자열
 * @param {Record<string, string|number|undefined|null>} data
 */
function interpolate(template, data) {
  if (typeof template !== "string") return "";
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = data[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** `**text**` → 이메일용 <strong> (welcome 등) */
function markdownBoldToEmailStrong(s) {
  return s.replace(/\*\*(.*?)\*\*/g, `<strong style="color:#ffffff">$1</strong>`);
}

/** 번들 문구의 줄바꿈(`\n`) → 이메일 HTML `<br />` (번들에는 `<br>` 태그 사용하지 않음) */
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