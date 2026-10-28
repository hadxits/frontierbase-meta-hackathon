/**
 * ============================================================================
 * billingReminderNotifications.js — 5-minute interval payment and subscription cancellation D-1 reminders.
 * ============================================================================
 *
 * - tenants: query billing.windowEndAt ∈ [current 5-minute slot + 24h, +5min) (one send per slot).
 * - Send payment reminders only if alarm.paymentDayBeforeMailing === true.
 * - Recipients: emails of members with role "admin" and status "Active" (multiple).
 * - Multilingual emails based on tenants.language (Resend).
 * ============================================================================
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runBillingReminderNotifications } = require("@/utils/billingReminders");
const { logAndCaptureError } = require("@/utils/logger");

const billingReminderNotifications = onSchedule(
  {
    schedule: "0 */6 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    cpu: "gcf_gen1",
    timeoutSeconds: 540,
  },
  async () => {
    try {
      await runBillingReminderNotifications();
    } catch (err) {
      logAndCaptureError(
        err instanceof Error ? err : new Error(String(err)),
        "[billingReminderNotifications] Scheduled run failed",
        {
          tenant_id: "system",
          function_name: "billingReminderNotifications"
        }
      );
      throw err;
    }
  }
);

module.exports = billingReminderNotifications;