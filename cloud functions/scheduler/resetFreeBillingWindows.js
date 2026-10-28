/**
 * ============================================================================
 * resetFreeBillingWindows.js — reset FREE plan expiration billing windows every 10 minutes.
 * ============================================================================
 *
 * - plan == FREE && billing.windowEndAt <= now
 * - New window and token_used_billing_month set to 0.
 * - After reset, windowEndAt moves to the future to prevent duplicate resets.
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