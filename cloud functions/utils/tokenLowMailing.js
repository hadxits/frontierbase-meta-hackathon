/**
 * tokenLowMailing.js — Notify when token balance is below 50% / 10% within billing window.
 * - Query only tenants with sent flags false for each threshold.
 * - Send threshold email if remaining / limit < threshold.
 * - Set sent flag to true on successful send.
 * - Reset sent50/sent10 to false when billing window resets.
 * - Recipients: emails of Active admin members (multiple), locale: tenant.language.
 *
 * When enabling tokenLowMailing in console, set sent50/sent10 to false to include in query.
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const checkTokenLimit = require("@/utils/checkTokenLimit");
const { sendTemplateEmail } = require("@/utils/sendEmailCommon");
const { TEMPLATE_CODES } = require("@/utils/emailTemplates");
const { resolveAdminEmails } = require("@/utils/billingReminders");
const { logInfo, logWarn } = require("@/utils/logger");

/** Start with higher ratio (50% → 10%). */
const TOKEN_LOW_THRESHOLDS = [
  {
    key: "50",
    ratio: 0.5,
    sentField: "tokenLowMailingSent50ThisWindow",
  },
  {
    key: "10",
    ratio: 0.1,
    sentField: "tokenLowMailingSent10ThisWindow",
  },
];

const SCAN_PAGE_SIZE = 100;
const DEFAULT_CONSOLE_BASE = "https://console.frontierbase.io";

function resolveTenantLocale(tenantData) {
  return String(tenantData?.language || "en").trim() || "en";
}

function parseWindowEndAtMs(billing) {
  const v = billing?.windowEndAt;
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @returns {{ remainingRatio: number|null, remainingPercent: number|null, details: object|null }}
 */
function evaluateTokenRemainingFromCheckResult(checkResult) {
  const details = checkResult?.details || null;
  if (!details) {
    return { remainingRatio: null, remainingPercent: null, details: null };
  }

  const { tokenLimitMonth, tokenUsedBillingMonth } = details;
  if (
    !Number.isFinite(tokenLimitMonth) ||
    tokenLimitMonth <= 0 ||
    !Number.isFinite(tokenUsedBillingMonth)
  ) {
    return { remainingRatio: null, remainingPercent: null, details };
  }

  const remaining = Math.max(0, tokenLimitMonth - tokenUsedBillingMonth);
  const remainingRatio = remaining / tokenLimitMonth;
  const remainingPercent = Math.max(0, Math.floor(remainingRatio * 100));
  return { remainingRatio, remainingPercent, details };
}

function isSentForThreshold(tenantData, sentField) {
  return tenantData?.alarm?.[sentField] === true;
}

/**
 * Query tenants not yet sent for each threshold and merge tenantIds.
 */
async function queryTokenLowCandidates() {
  const byId = new Map();

  for (const threshold of TOKEN_LOW_THRESHOLDS) {
    const snap = await store
      .collection(Collection.TENANTS)
      .where("alarm.tokenLowMailing", "==", true)
      .where(`alarm.${threshold.sentField}`, "==", false)
      .limit(SCAN_PAGE_SIZE)
      .get();

    for (const doc of snap.docs) {
      if (!byId.has(doc.id)) {
        byId.set(doc.id, doc);
      }
    }
  }

  return [...byId.values()];
}

async function markTokenLowMailingSent(tenantId, sentField, windowEndAtMs) {
  await store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .update({
      [`alarm.${sentField}`]: true,
      "alarm.tokenLowMailingSentWindowEndAt": windowEndAtMs,
    });
}

async function sendTokenLowMail({
  tenantId,
  locale,
  to,
  variables,
}) {
  try {
    const r = await sendTemplateEmail({
      templateCode: TEMPLATE_CODES.TOKEN_LOW_REMINDER,
      to,
      locale,
      variables,
    });
    const success = !!r?.success;
    if (!success) {
      logWarn("[tokenLowMailing] Admin email send failed", {
        tenant_id: tenantId,
        function_name: "sendTokenLowMail",
        extra: { to, messageId: r?.messageId },
      });
    }
    return { success, messageId: r?.messageId };
  } catch (err) {
    logWarn("[tokenLowMailing] Admin email send error", {
      tenant_id: tenantId,
      function_name: "sendTokenLowMail",
      extra: {
        to,
        error: err?.message || String(err),
      },
    });
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * @returns {Promise<object>} execution summary
 */
async function runTokenLowNotifications() {
  const summary = {
    scanned_at: new Date().toISOString(),
    scanned_count: 0,
    due_count: 0,
    sent: 0,
    skipped_no_admin_email: 0,
    skipped_already_sent: 0,
    skipped_not_low: 0,
    skipped_no_window: 0,
  };

  const docs = await queryTokenLowCandidates();
  for (const doc of docs) {
    summary.scanned_count += 1;
    const tenantId = doc.id;
    const tenantData = doc.data() || {};
    const windowEndAtMs = parseWindowEndAtMs(tenantData.billing);

    if (windowEndAtMs == null) {
      summary.skipped_no_window += 1;
      continue;
    }

    const dueThresholds = TOKEN_LOW_THRESHOLDS.filter(
      (t) => !isSentForThreshold(tenantData, t.sentField)
    );
    if (dueThresholds.length === 0) {
      summary.skipped_already_sent += 1;
      continue;
    }

    const checkResult = await checkTokenLimit(tenantId, { tenantData });
    const evalResult = evaluateTokenRemainingFromCheckResult(checkResult);
    const { remainingRatio, remainingPercent, details } = evalResult;

    if (remainingRatio == null) {
      summary.skipped_not_low += 1;
      continue;
    }

    const crossed = dueThresholds.filter((t) => remainingRatio < t.ratio);
    if (crossed.length === 0) {
      summary.skipped_not_low += 1;
      continue;
    }

    const adminEmails = await resolveAdminEmails(tenantId);
    if (adminEmails.length === 0) {
      summary.skipped_no_admin_email += 1;
      logWarn("[tokenLowMailing] No admin member emails", {
        tenant_id: tenantId,
        function_name: "runTokenLowNotifications",
      });
      continue;
    }

    summary.due_count += 1;
    const locale = resolveTenantLocale(tenantData);
    const baseVars = {
      tenantName: String(tenantData.name || "").trim(),
      plan: String(details?.plan || tenantData.plan || "").trim(),
      remainingPercentLabel: `${remainingPercent}%`,
      tokenUsedLabel: String(details?.tokenUsedBillingMonth ?? ""),
      tokenLimitLabel: String(details?.tokenLimitMonth ?? ""),
      billingConsoleUrl: DEFAULT_CONSOLE_BASE,
    };

    for (const threshold of crossed) {
      const thresholdPercentLabel = `${Math.round(threshold.ratio * 100)}%`;
      const { success } = await sendTokenLowMail({
        tenantId,
        locale,
        to: adminEmails,
        variables: {
          ...baseVars,
          thresholdPercentLabel,
        },
      });
      if (!success) continue;

      summary.sent += 1;
      try {
        await markTokenLowMailingSent(
          tenantId,
          threshold.sentField,
          windowEndAtMs
        );
        // For threshold checks continuing in the same run.
        if (!tenantData.alarm) tenantData.alarm = {};
        tenantData.alarm[threshold.sentField] = true;
      } catch (err) {
        logWarn("[tokenLowMailing] Failed to mark sent threshold", {
          tenant_id: tenantId,
          function_name: "runTokenLowNotifications",
          extra: {
            error: err?.message || String(err),
            windowEndAtMs,
            sentField: threshold.sentField,
          },
        });
      }
    }
  }

  logInfo("[tokenLowMailing] Run completed", {
    tenant_id: "system",
    function_name: "runTokenLowNotifications",
    extra: summary,
  });

  return summary;
}

module.exports = {
  runTokenLowNotifications,
  evaluateTokenRemainingFromCheckResult,
  TOKEN_LOW_THRESHOLDS,
};