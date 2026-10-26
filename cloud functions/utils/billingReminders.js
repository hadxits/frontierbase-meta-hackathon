/**
 * billingReminders.js — 결제·구독 취소 예약 D-1 알림
 * - 5분 스케줄마다 billing.windowEndAt ∈ [이번 슬롯+24h, 이번 슬롯+24h+5분) 쿼리 → 슬롯당 1회 발송
 * - 결제 리마인더: tenants.alarm.paymentDayBeforeMailing === true 일 때만 발송
 * - 수신: tenants/{tenantId}/members 중 role === "admin" 이고 status === "Active" 인 멤버 email (복수)
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { parseIsoToMs } = require("@/utils/lemonsqueezy");
const { sendTemplateEmail } = require("@/utils/sendEmailCommon");
const { TEMPLATE_CODES } = require("@/utils/emailTemplates");
const { logInfo, logWarn } = require("@/utils/logger");
const { isActiveMemberStatus } = require("@/utils/tenantMembership");

const FIVE_MIN_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_PAGE_SIZE = 100;
const DEFAULT_CONSOLE_BASE = "https://console.frontierbase.io";
const BILLING_REMINDER_TIMEZONE = "Asia/Seoul";
const MEMBER_ROLE_ADMIN = "admin";

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

function parseTimestampMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return parseIsoToMs(value);
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function getKstCalendarParts(ms) {
  const kst = new Date(ms + KST_OFFSET_MS);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth(),
    day: kst.getUTCDate(),
  };
}

function isSameKstCalendarDay(msA, msB) {
  if (!Number.isFinite(msA) || !Number.isFinite(msB)) return false;
  const a = getKstCalendarParts(msA);
  const b = getKstCalendarParts(msB);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * 이번 5분 실행 슬롯 기준 D-1: windowEndAt ∈ [runBucket+24h, runBucket+24h+5분)
 * 예) windowEndAt이 24h 뒤 12:05 구간 → 오늘 12:05 스케줄 실행 시에만 매칭
 */
function getWindowEndAtQueryBoundsForRun(nowMs = Date.now()) {
  const runBucketMs = Math.floor(nowMs / FIVE_MIN_MS) * FIVE_MIN_MS;
  return {
    startMs: runBucketMs + DAY_MS,
    endMs: runBucketMs + DAY_MS + FIVE_MIN_MS,
    runBucketMs,
  };
}

function resolveTenantLocale(tenantData) {
  const raw = String(tenantData?.language || "en").trim() || "en";
  return raw;
}

function formatDateForTenantLocale(tsMs, locale) {
  if (!Number.isFinite(tsMs)) return "";
  const bcp47 = LOCALE_TO_BCP47[locale] || LOCALE_TO_BCP47.en;
  try {
    return new Intl.DateTimeFormat(bcp47, {
      timeZone: BILLING_REMINDER_TIMEZONE,
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(new Date(tsMs));
  } catch {
    return new Date(tsMs).toISOString();
  }
}

function isValidEmail(email) {
  const s = String(email || "").trim();
  return s.length > 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * 테넌트 admin 멤버 email 목록 (Active만, 중복 제거)
 * Waiting/Archived/Deleted 등 Active 외 상태는 제외
 * @param {string} tenantId
 * @returns {Promise<string[]>}
 */
async function resolveAdminEmails(tenantId) {
  const id = String(tenantId || "").trim();
  if (!id) return [];

  const snap = await store
    .collection(Collection.TENANTS)
    .doc(id)
    .collection(Collection.MEMBERS)
    .where("role", "==", MEMBER_ROLE_ADMIN)
    .get();

  const emails = [];
  const seen = new Set();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (!isActiveMemberStatus(data.status)) continue;
    const email = String(data.email || "").trim();
    if (!isValidEmail(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return emails;
}

function isPaymentDayBeforeMailingEnabled(tenantData) {
  return tenantData?.alarm?.paymentDayBeforeMailing === true;
}

async function queryTenantsWithWindowEndInBounds(bounds) {
  return store
    .collection(Collection.TENANTS)
    .where("billing.windowEndAt", ">=", bounds.startMs)
    .where("billing.windowEndAt", "<", bounds.endMs)
    .limit(SCAN_PAGE_SIZE)
    .get();
}

function isScheduledCancellation(billing) {
  const cancelPending = billing?.subscription_cancellation_pending;
  return (
    !!cancelPending &&
    String(cancelPending.status || "").toLowerCase() === "scheduled"
  );
}

function buildPaymentReminder(tenantData, windowEndMs) {
  if (!isPaymentDayBeforeMailingEnabled(tenantData)) return null;

  const billing = tenantData.billing || {};
  const plan = String(tenantData.plan || "FREE").toUpperCase();
  if (plan === "FREE" || isScheduledCancellation(billing)) return null;

  const locale = resolveTenantLocale(tenantData);
  return {
    chargeDateLabel: formatDateForTenantLocale(windowEndMs, locale),
    plan,
  };
}

function buildCancellationReminder(tenantData, windowEndMs) {
  const billing = tenantData.billing || {};
  const cancelPending = billing.subscription_cancellation_pending;
  if (!isScheduledCancellation(billing)) return null;

  const effectiveAtMs = parseTimestampMs(cancelPending.effective_at);
  const effectiveMs = effectiveAtMs ?? windowEndMs;
  if (effectiveAtMs != null && !isSameKstCalendarDay(effectiveMs, windowEndMs)) {
    return null;
  }

  const locale = resolveTenantLocale(tenantData);
  return {
    effectiveDateLabel: formatDateForTenantLocale(effectiveMs, locale),
  };
}

/**
 * @param {{ startMs: number, endMs: number }} bounds
 * @returns {Promise<Array<{ tenantId: string, locale: string, tenantName: string, payment?: object, cancellation?: object }>>}
 */
async function scanTenantsForBillingReminders(bounds) {
  const snap = await queryTenantsWithWindowEndInBounds(bounds);
  const due = [];

  for (const doc of snap.docs) {
    const tenantData = doc.data() || {};
    const windowEndMs = parseTimestampMs(tenantData.billing?.windowEndAt);
    if (windowEndMs == null) continue;

    const payment = buildPaymentReminder(tenantData, windowEndMs);
    const cancellation = buildCancellationReminder(tenantData, windowEndMs);
    if (!payment && !cancellation) continue;

    due.push({
      tenantId: doc.id,
      locale: resolveTenantLocale(tenantData),
      tenantName: String(tenantData.name || "").trim(),
      ...(payment && { payment }),
      ...(cancellation && { cancellation }),
    });
  }

  return due;
}

async function sendReminderEmail({
  tenantId,
  locale,
  templateCode,
  variables,
  to,
}) {
  try {
    const r = await sendTemplateEmail({
      templateCode,
      to,
      locale,
      variables,
    });
    const success = !!r?.success;
    if (!success) {
      logWarn("[billingReminders] Admin email send failed", {
        tenant_id: tenantId,
        function_name: "sendReminderEmail",
        extra: { templateCode, to, messageId: r?.messageId },
      });
    }
    return { success, messageId: r?.messageId };
  } catch (err) {
    logWarn("[billingReminders] Admin email send error", {
      tenant_id: tenantId,
      function_name: "sendReminderEmail",
      extra: {
        templateCode,
        to,
        error: err?.message || String(err),
      },
    });
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * @returns {Promise<object>} 실행 요약
 */
async function runBillingReminderNotifications() {
  const bounds = getWindowEndAtQueryBoundsForRun();
  const dueTenants = await scanTenantsForBillingReminders(bounds);

  const summary = {
    scanned_at: new Date().toISOString(),
    timezone: BILLING_REMINDER_TIMEZONE,
    window_end_query: {
      runBucketMs: bounds.runBucketMs,
      startMs: bounds.startMs,
      endMs: bounds.endMs,
    },
    due_tenant_count: dueTenants.length,
    payment_sent: 0,
    cancellation_sent: 0,
    skipped_no_admin_email: 0,
  };

  for (const entry of dueTenants) {
    const { tenantId, locale, tenantName, payment, cancellation } = entry;
    const adminEmails = await resolveAdminEmails(tenantId);

    if (adminEmails.length === 0) {
      summary.skipped_no_admin_email += 1;
      logWarn("[billingReminders] No admin member emails", {
        tenant_id: tenantId,
        function_name: "runBillingReminderNotifications",
        extra: { has_payment: !!payment, has_cancellation: !!cancellation },
      });
      continue;
    }

    const baseVars = {
      tenantName,
      billingConsoleUrl: DEFAULT_CONSOLE_BASE,
    };

    if (payment) {
      const { success } = await sendReminderEmail({
        tenantId,
        locale,
        templateCode: TEMPLATE_CODES.BILLING_PAYMENT_REMINDER,
        variables: {
          ...baseVars,
          chargeDateLabel: payment.chargeDateLabel,
          plan: payment.plan,
        },
        to: adminEmails,
      });
      if (success) summary.payment_sent += 1;
    }

    if (cancellation) {
      const { success } = await sendReminderEmail({
        tenantId,
        locale,
        templateCode: TEMPLATE_CODES.BILLING_CANCELLATION_REMINDER,
        variables: {
          ...baseVars,
          effectiveDateLabel: cancellation.effectiveDateLabel,
        },
        to: adminEmails,
      });
      if (success) summary.cancellation_sent += 1;
    }
  }

  logInfo("[billingReminders] Run completed", {
    tenant_id: "system",
    function_name: "runBillingReminderNotifications",
    extra: summary,
  });

  return summary;
}

module.exports = {
  runBillingReminderNotifications,
  scanTenantsForBillingReminders,
  resolveAdminEmails,
  getWindowEndAtQueryBoundsForRun,
  queryTenantsWithWindowEndInBounds,
};