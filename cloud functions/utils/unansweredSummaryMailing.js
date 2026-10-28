/**
 * unansweredSummaryMailing.js — Daily summary email of unanswered questions from previous day (UTC).
 * - alarm.unansweredSummaryMailing === true
 * - Once per day: skip if alarm.unansweredSummaryMailingLastSentDateKey equals yesterday's dateKey.
 * - Aggregate analytics_unanswered created_at range (UTC yesterday period).
 * - For large volume: totalCount + top-N question previews (with time metadata).
 * - Do not send if count is zero.
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { sendTemplateEmail } = require("@/utils/sendEmailCommon");
const { TEMPLATE_CODES } = require("@/utils/emailTemplates");
const { resolveAdminEmails } = require("@/utils/billingReminders");
const { logInfo, logWarn } = require("@/utils/logger");
const {
  DEFAULT_CONSOLE_BASE,
  resolveTenantLocale,
  getYesterdayUtcRange,
  formatDateForTenantLocale,
  formatTimeForTenantLocale,
  escapeHtml,
  forEachTenantWithAlarm,
  markSummaryMailingSent,
  wasSummaryAlreadySent,
} = require("@/utils/summaryMailingCommon");

const ALARM_FIELD = "unansweredSummaryMailing";
const LAST_SENT_FIELD = "unansweredSummaryMailingLastSentDateKey";
/** Number of questions to list in email body. */
const MAX_LIST_ITEMS = 20;
const QUESTION_PREVIEW_CHARS = 120;

function unansweredQuery(tenantId, startMs, endMs) {
  return store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.ANALYTICS_UNANSWERED)
    .where("created_at", ">=", startMs)
    .where("created_at", "<", endMs);
}

/**
 * @returns {Promise<{
 *   totalCount: number,
 *   items: Array<{ question: string, createdAtMs: number|null }>
 * }>}
 */
async function loadUnansweredSummary(tenantId, startMs, endMs) {
  const base = unansweredQuery(tenantId, startMs, endMs);

  /** @type {number|null} */
  let totalCount = null;
  try {
    const countSnap = await base.count().get();
    totalCount = Number(countSnap.data().count || 0);
  } catch (err) {
    logWarn("[unansweredSummaryMailing] count() failed; falling back to scan", {
      tenant_id: tenantId,
      function_name: "loadUnansweredSummary",
      extra: { error: err?.message || String(err) },
    });
  }

  if (totalCount === 0) {
    return { totalCount: 0, items: [] };
  }

  const snap = await base
    .orderBy("created_at", "desc")
    .limit(MAX_LIST_ITEMS)
    .get();

  if (snap.empty) {
    return { totalCount: 0, items: [] };
  }

  const items = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const question = String(data.question || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, QUESTION_PREVIEW_CHARS);
    const createdAtMs = Number(data.created_at);
    items.push({
      question: question || "(empty)",
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
    });
  }

  if (totalCount == null) {
    // If count fails, only lower bound is known (number listed in body).
    totalCount = items.length;
  }

  return { totalCount, items };
}

function buildItemsHtml(items, locale) {
  if (!items.length) {
    return `<p style="margin:0;font-size:15px;color:#b0b0b0;line-height:1.6">—</p>`;
  }
  const lis = items
    .map((item) => {
      const q = escapeHtml(item.question);
      const timeLabel = formatTimeForTenantLocale(item.createdAtMs, locale);
      const meta = timeLabel
        ? `<div style="margin-top:4px;font-size:12px;color:#808080">${escapeHtml(timeLabel)}</div>`
        : "";
      return `<li style="margin:0 0 12px 0;padding:0;color:#e5e5e5;font-size:15px;line-height:1.55">
        <div>${q}</div>
        ${meta}
      </li>`;
    })
    .join("");
  return `<ol style="margin:0;padding-left:22px;text-align:left">${lis}</ol>`;
}

async function sendUnansweredSummaryMail({ tenantId, locale, to, variables }) {
  try {
    const r = await sendTemplateEmail({
      templateCode: TEMPLATE_CODES.UNANSWERED_SUMMARY,
      to,
      locale,
      variables,
    });
    const success = !!r?.success;
    if (!success) {
      logWarn("[unansweredSummaryMailing] Admin email send failed", {
        tenant_id: tenantId,
        function_name: "sendUnansweredSummaryMail",
        extra: { to, messageId: r?.messageId },
      });
    }
    return { success, messageId: r?.messageId };
  } catch (err) {
    logWarn("[unansweredSummaryMailing] Admin email send error", {
      tenant_id: tenantId,
      function_name: "sendUnansweredSummaryMail",
      extra: { to, error: err?.message || String(err) },
    });
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * @returns {Promise<object>}
 */
async function runUnansweredSummaryNotifications() {
  const { dateKey, startMs, endMs } = getYesterdayUtcRange();
  const summary = {
    scanned_at: new Date().toISOString(),
    summary_date_key: dateKey,
    range_start_ms: startMs,
    range_end_ms: endMs,
    scanned_count: 0,
    due_count: 0,
    sent: 0,
    skipped_already_sent: 0,
    skipped_no_activity: 0,
    skipped_no_admin_email: 0,
    failed_send: 0,
  };

  summary.scanned_count = await forEachTenantWithAlarm(ALARM_FIELD, async (doc) => {
    const tenantId = doc.id;
    const tenantData = doc.data() || {};

    if (wasSummaryAlreadySent(tenantData, LAST_SENT_FIELD, dateKey)) {
      summary.skipped_already_sent += 1;
      return;
    }

    let stats;
    try {
      stats = await loadUnansweredSummary(tenantId, startMs, endMs);
    } catch (err) {
      logWarn("[unansweredSummaryMailing] Failed to load summary", {
        tenant_id: tenantId,
        function_name: "runUnansweredSummaryNotifications",
        extra: { error: err?.message || String(err), dateKey },
      });
      return;
    }

    if (stats.totalCount <= 0) {
      summary.skipped_no_activity += 1;
      return;
    }

    const adminEmails = await resolveAdminEmails(tenantId);
    if (adminEmails.length === 0) {
      summary.skipped_no_admin_email += 1;
      logWarn("[unansweredSummaryMailing] No admin member emails", {
        tenant_id: tenantId,
        function_name: "runUnansweredSummaryNotifications",
      });
      return;
    }

    summary.due_count += 1;
    const locale = resolveTenantLocale(tenantData);
    const dateLabel = formatDateForTenantLocale(dateKey, locale);
    const listed = stats.items.length;
    const moreCount = Math.max(0, stats.totalCount - listed);

    const { success } = await sendUnansweredSummaryMail({
      tenantId,
      locale,
      to: adminEmails,
      variables: {
        tenantName: String(tenantData.name || "").trim(),
        dateLabel,
        totalCountLabel: String(stats.totalCount),
        itemsHtml: buildItemsHtml(stats.items, locale),
        moreCountLabel: moreCount > 0 ? String(moreCount) : "",
        listedCountLabel: String(listed),
        analyticsConsoleUrl: DEFAULT_CONSOLE_BASE,
      },
    });

    if (!success) {
      summary.failed_send += 1;
      return;
    }

    summary.sent += 1;
    try {
      await markSummaryMailingSent(tenantId, LAST_SENT_FIELD, dateKey);
    } catch (err) {
      logWarn("[unansweredSummaryMailing] Failed to mark sent", {
        tenant_id: tenantId,
        function_name: "runUnansweredSummaryNotifications",
        extra: { error: err?.message || String(err), dateKey },
      });
    }
  });

  logInfo("[unansweredSummaryMailing] Run completed", {
    tenant_id: "system",
    function_name: "runUnansweredSummaryNotifications",
    extra: summary,
  });

  return summary;
}

module.exports = {
  runUnansweredSummaryNotifications,
  loadUnansweredSummary,
  LAST_SENT_FIELD,
  ALARM_FIELD,
  MAX_LIST_ITEMS,
};