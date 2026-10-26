/**
 * ============================================================================
 * billingReminderNotifications.js — 5분 주기 결제·구독 취소 D-1 알림
 * ============================================================================
 *
 * - tenants: billing.windowEndAt ∈ [이번 5분 슬롯+24h, +5분) 쿼리 (슬롯당 1회 발송)
 * - 결제 리마인더: alarm.paymentDayBeforeMailing === true 일 때만 발송
 * - 수신: members.role === "admin" && status === "Active" 인 멤버 email (복수)
 * - tenants.language 기준 다국어 메일 (Resend)
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