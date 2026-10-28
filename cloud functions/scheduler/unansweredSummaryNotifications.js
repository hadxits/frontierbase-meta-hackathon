/**
 * ============================================================================
 * unansweredSummaryNotifications.js — Daily summary email of unanswered items from the previous day
 * ============================================================================
 *
 * - Runs daily at 09:00 Asia/Seoul (= UTC 00:00, right after previous UTC day ends).
 * - Summary target: UTC yesterday
 * - Tenants where alarm.unansweredSummaryMailing === true
 * - Once per day (unansweredSummaryMailingLastSentDateKey)
 * - Large volume: total count + type aggregation + top-N question previews
 * - Recipients: emails of Active admin members (multiple), locale: tenant.language.
 * ============================================================================
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  runUnansweredSummaryNotifications,
} = require("@/utils/unansweredSummaryMailing");
const { logAndCaptureError } = require("@/utils/logger");

const unansweredSummaryNotifications = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    cpu: "gcf_gen1",
    timeoutSeconds: 540,
  },
  async () => {
    try {
      await runUnansweredSummaryNotifications();
    } catch (err) {
      logAndCaptureError(
        err instanceof Error ? err : new Error(String(err)),
        "[unansweredSummaryNotifications] Scheduled run failed",
        {
          tenant_id: "system",
          function_name: "unansweredSummaryNotifications",
        }
      );
      throw err;
    }
  }
);

module.exports = unansweredSummaryNotifications;