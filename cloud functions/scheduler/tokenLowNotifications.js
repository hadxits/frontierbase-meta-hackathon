/**
 * ============================================================================
 * tokenLowNotifications.js — notify when token balance is below 50% or 10% (once per threshold per window).
 * ============================================================================
 *
 * - Scan if tokenLowMailing === true and sent50 or sent10 is false.
 * - Send threshold email if balance < 50% or < 10% to Active admin members (multiple).
 * - After sending, tokenLowMailingSent50/10ThisWindow = true (resets to false when the window resets)
 * - Multilingual emails based on tenants.language (Resend).
 * ============================================================================
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runTokenLowNotifications } = require("@/utils/tokenLowMailing");
const { logAndCaptureError } = require("@/utils/logger");

const tokenLowNotifications = onSchedule(
  {
    schedule: "0 */6 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    cpu: "gcf_gen1",
    timeoutSeconds: 540,
  },
  async () => {
    try {
      await runTokenLowNotifications();
    } catch (err) {
      logAndCaptureError(
        err instanceof Error ? err : new Error(String(err)),
        "[tokenLowNotifications] Scheduled run failed",
        {
          tenant_id: "system",
          function_name: "tokenLowNotifications",
        }
      );
      throw err;
    }
  }
);

module.exports = tokenLowNotifications;