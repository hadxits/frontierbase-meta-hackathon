/**
 * ============================================================================
 * responseSummaryNotifications.js — daily summary emails of previous day's responses (conversations).
 * ============================================================================
 *
 * - Runs daily at 09:00 Asia/Seoul (= UTC 00:00, right after previous UTC day ends).
 * - Summary target: UTC yesterday (matches usage_daily / analytics dateKey).
 * - Tenants with alarm.responseSummaryMailing === true.
 * - Once per day (tracked by responseSummaryMailingLastSentDateKey).
 * - Recipients: emails of Active admin members (multiple), locale: tenant.language.
 * ============================================================================
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runResponseSummaryNotifications } = require("@/utils/responseSummaryMailing");
const { logAndCaptureError } = require("@/utils/logger");

const responseSummaryNotifications = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    cpu: "gcf_gen1",
    timeoutSeconds: 540,
  },
  async () => {
    try {
      await runResponseSummaryNotifications();
    } catch (err) {
      logAndCaptureError(
        err instanceof Error ? err : new Error(String(err)),
        "[responseSummaryNotifications] Scheduled run failed",
        {
          tenant_id: "system",
          function_name: "responseSummaryNotifications",
        }
      );
      throw err;
    }
  }
);

module.exports = responseSummaryNotifications;