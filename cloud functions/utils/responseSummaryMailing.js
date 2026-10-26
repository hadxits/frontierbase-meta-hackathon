/**
 * responseSummaryMailing.js — 전날(UTC) 응답(대화) 일일 요약 메일
 * - alarm.responseSummaryMailing === true
 * - 하루 1회: alarm.responseSummaryMailingLastSentDateKey === yesterday dateKey 이면 스킵
 * - usage_daily + analytics_question_type_daily 집계 (메시지/질문유형 top-N)
 * - message.total <= 0 이면 미발송 (사용자 체감 대화 건수 기준; bypass 답변도 message에 포함되어야 함)
 * - dateKey·구간은 usage/analytics 와 동일하게 UTC
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
  escapeHtml,
  forEachTenantWithAlarm,
  markSummaryMailingSent,
  wasSummaryAlreadySent,
} = require("@/utils/summaryMailingCommon");

const ALARM_FIELD = "responseSummaryMailing";
const LAST_SENT_FIELD = "responseSummaryMailingLastSentDateKey";
const META_KEYS = new Set([
  "date_key",
  "tenant_id",
  "updated_at",
  "created_at",
  "month_key",
]);
const MAX_QUESTION_TYPES = 10;

function readNestedTotal(obj, key) {
  if (!obj || typeof obj !== "object") return 0;
  const nested = obj[key];
  if (nested && typeof nested === "object" && Number.isFinite(Number(nested.total))) {
    return Number(nested.total);
  }
  const flat = obj[`${key}.total`];
  if (Number.isFinite(Number(flat))) return Number(flat);
  return 0;
}

/**
 * @returns {Promise<{ messageTotal: number, questionTypes: Array<{ type: string, count: number }> }>}
 */
async function loadResponseSummary(tenantId, dateKey) {
  const tenantRef = store.collection(Collection.TENANTS).doc(tenantId);
  const [usageSnap, typeSnap] = await Promise.all([
    tenantRef.collection(Collection.USAGE_DAILY).doc(dateKey).get(),
    tenantRef.collection(Collection.ANALYTICS_QUESTION_TYPE_DAILY).doc(dateKey).get(),
  ]);

  const usage = usageSnap.exists ? usageSnap.data() || {} : {};
  const messageTotal = readNestedTotal(usage, "message");

  const questionTypes = [];
  if (typeSnap.exists) {
    const data = typeSnap.data() || {};
    for (const [key, value] of Object.entries(data)) {
      if (META_KEYS.has(key)) continue;
      const count = Number(value);
      if (!Number.isFinite(count) || count <= 0) continue;
      questionTypes.push({ type: String(key), count });
    }
    questionTypes.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  }

  return {
    messageTotal,
    questionTypes: questionTypes.slice(0, MAX_QUESTION_TYPES),
    questionTypeTotalShown: Math.min(questionTypes.length, MAX_QUESTION_TYPES),
    questionTypeTotalAll: questionTypes.length,
  };
}

function buildQuestionTypesHtml(questionTypes) {
  if (!questionTypes.length) {
    return `<p style="margin:0;font-size:15px;color:#b0b0b0;line-height:1.6">—</p>`;
  }
  const rows = questionTypes
    .map(
      (item) =>
        `<tr>
          <td style="padding:6px 0;font-size:15px;color:#e5e5e5;border-bottom:1px solid #1a1a1a">${escapeHtml(item.type)}</td>
          <td align="right" style="padding:6px 0 6px 16px;font-size:15px;color:#ffffff;border-bottom:1px solid #1a1a1a;white-space:nowrap">${escapeHtml(String(item.count))}</td>
        </tr>`
    )
    .join("");
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">${rows}</table>`;
}

async function sendResponseSummaryMail({ tenantId, locale, to, variables }) {
  try {
    const r = await sendTemplateEmail({
      templateCode: TEMPLATE_CODES.RESPONSE_SUMMARY,
      to,
      locale,
      variables,
    });
    const success = !!r?.success;
    if (!success) {
      logWarn("[responseSummaryMailing] Admin email send failed", {
        tenant_id: tenantId,
        function_name: "sendResponseSummaryMail",
        extra: { to, messageId: r?.messageId },
      });
    }
    return { success, messageId: r?.messageId };
  } catch (err) {
    logWarn("[responseSummaryMailing] Admin email send error", {
      tenant_id: tenantId,
      function_name: "sendResponseSummaryMail",
      extra: { to, error: err?.message || String(err) },
    });
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * @returns {Promise<object>}
 */
async function runResponseSummaryNotifications() {
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
      stats = await loadResponseSummary(tenantId, dateKey);
    } catch (err) {
      logWarn("[responseSummaryMailing] Failed to load summary", {
        tenant_id: tenantId,
        function_name: "runResponseSummaryNotifications",
        extra: { error: err?.message || String(err), dateKey },
      });
      return;
    }

    // 사용자 체감 활동은 메시지 수. 임베딩-only/메인모델 bypass 등으로
    // 토큰·질문유형만 있고 Messages=0인 날은 발송하지 않음.
    if (stats.messageTotal <= 0) {
      summary.skipped_no_activity += 1;
      return;
    }

    const adminEmails = await resolveAdminEmails(tenantId);
    if (adminEmails.length === 0) {
      summary.skipped_no_admin_email += 1;
      logWarn("[responseSummaryMailing] No admin member emails", {
        tenant_id: tenantId,
        function_name: "runResponseSummaryNotifications",
      });
      return;
    }

    summary.due_count += 1;
    const locale = resolveTenantLocale(tenantData);
    const dateLabel = formatDateForTenantLocale(dateKey, locale);
    const moreTypes =
      stats.questionTypeTotalAll > stats.questionTypeTotalShown
        ? stats.questionTypeTotalAll - stats.questionTypeTotalShown
        : 0;

    const { success } = await sendResponseSummaryMail({
      tenantId,
      locale,
      to: adminEmails,
      variables: {
        tenantName: String(tenantData.name || "").trim(),
        dateLabel,
        messageTotalLabel: String(stats.messageTotal),
        questionTypesHtml: buildQuestionTypesHtml(stats.questionTypes),
        moreTypesLabel: moreTypes > 0 ? String(moreTypes) : "",
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
      logWarn("[responseSummaryMailing] Failed to mark sent", {
        tenant_id: tenantId,
        function_name: "runResponseSummaryNotifications",
        extra: { error: err?.message || String(err), dateKey },
      });
    }
  });

  logInfo("[responseSummaryMailing] Run completed", {
    tenant_id: "system",
    function_name: "runResponseSummaryNotifications",
    extra: summary,
  });

  return summary;
}

module.exports = {
  runResponseSummaryNotifications,
  loadResponseSummary,
  LAST_SENT_FIELD,
  ALARM_FIELD,
};