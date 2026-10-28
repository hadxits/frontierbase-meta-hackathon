/**
 * summaryMailingCommon.js — daily response/unanswered summary mail common.
 * - "Yesterday" period and dateKey based on UTC (same as usage_daily / analytics).
 * - Scan tenant pages where alarm.*Mailing === true.
 * - Once per day: skip if lastSentDateKey === summaryDateKey.
 */
const { store } = require("@/firebase");
const { FieldPath } = require("firebase-admin/firestore");
const Collection = require("@/const/firestore/Collection");
const {
  toUtcDateKey,
  getYesterdayUtcRange,
} = require("@/utils/utcDateKey");

const SCAN_PAGE_SIZE = 100;
const DEFAULT_CONSOLE_BASE = "https://console.frontierbase.io";
/** Mail date/time labels use UTC, matching the aggregation standard. */
const SUMMARY_TIMEZONE = "UTC";

const LOCALE_TO_BCP47 = {
  en: "en-US",
  ko: "ko-KR",
  ja: "ja-JP",
  de: "de-DE",
  fr: "fr-FR",
  it: "it-IT",
  zh: "zh-TW",
  es: "es-ES",
};

function resolveTenantLocale(tenantData) {
  return String(tenantData?.language || "en").trim() || "en";
}

/**
 * Format dateKey (UTC YYYY-MM-DD) into tenant locale text (always UTC, suffix UTC).
 */
function formatDateForTenantLocale(dateKey, locale) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!m) return String(dateKey || "");
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  const bcp47 = LOCALE_TO_BCP47[locale] || LOCALE_TO_BCP47.en;
  try {
    const label = new Intl.DateTimeFormat(bcp47, {
      timeZone: SUMMARY_TIMEZONE,
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(new Date(ms));
    return /UTC/i.test(label) ? label : `${label} UTC`;
  } catch {
    return `${dateKey} UTC`;
  }
}

/** Time label based on UTC. */
function formatTimeForTenantLocale(ms, locale) {
  if (!Number.isFinite(ms)) return "";
  const bcp47 = LOCALE_TO_BCP47[locale] || LOCALE_TO_BCP47.en;
  try {
    return new Intl.DateTimeFormat(bcp47, {
      timeZone: SUMMARY_TIMEZONE,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

function escapeHtml(input) {
  const s = typeof input === "string" ? input : String(input ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Iterate tenants with alarmField === true by page.
 * @param {string} alarmField - e.g., "responseSummaryMailing"
 * @param {(doc: FirebaseFirestore.QueryDocumentSnapshot) => Promise<void>|void} onDoc
 */
async function forEachTenantWithAlarm(alarmField, onDoc) {
  let lastDoc = null;
  let scanned = 0;

  while (true) {
    let q = store
      .collection(Collection.TENANTS)
      .where(`alarm.${alarmField}`, "==", true)
      .orderBy(FieldPath.documentId())
      .limit(SCAN_PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      await onDoc(doc);
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < SCAN_PAGE_SIZE) break;
  }

  return scanned;
}

async function markSummaryMailingSent(tenantId, lastSentField, dateKey) {
  await store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .update({
      [`alarm.${lastSentField}`]: String(dateKey),
    });
}

function wasSummaryAlreadySent(tenantData, lastSentField, dateKey) {
  return String(tenantData?.alarm?.[lastSentField] || "") === String(dateKey);
}

module.exports = {
  SCAN_PAGE_SIZE,
  DEFAULT_CONSOLE_BASE,
  SUMMARY_TIMEZONE,
  resolveTenantLocale,
  toUtcDateKey,
  getYesterdayUtcRange,
  formatDateForTenantLocale,
  formatTimeForTenantLocale,
  escapeHtml,
  forEachTenantWithAlarm,
  markSummaryMailingSent,
  wasSummaryAlreadySent,
};