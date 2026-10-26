/**
 * ============================================================================
 * resetFreeBillingWindows.js — FREE 플랜 만료 빌링 윈도우 10분 주기 리셋
 * ============================================================================
 *
 * - plan == FREE && billing.windowEndAt <= now
 * - 새 window + token_used_billing_month = 0
 * - 리셋 후 windowEndAt이 미래로 바뀌어 중복 리셋되지 않음
 * ============================================================================
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runResetFreeBillingWindows } = require("@/utils/resetFreeBillingWindows");
const { logAndCaptureError } = require("@/utils/logger");
const { flushSentry } = require("@/utils/sentry");

const resetFreeBillingWindows = onSchedule(
  {
    schedule: "0 */6 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    timeoutSeconds: 540,
    cpu : "gcf_gen1"
  },
  async () => {
    try {
      await runResetFreeBillingWindows();
    } catch (err) {
      logAndCaptureError(
        err instanceof Error ? err : new Error(String(err)),
        "[resetFreeBillingWindows] Scheduled run failed",
        {
          tenant_id: "system",
          function_name: "resetFreeBillingWindows",
        }
      );
      throw err;
    } finally {
      await flushSentry();
    }
  }
);

module.exports = resetFreeBillingWindows;