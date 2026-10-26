/**
 * ============================================================================
 * tokenLowNotifications.js — 토큰 잔량 50% / 10% 미만 알림 (임계값·윈도우당 1회)
 * ============================================================================
 *
 * - tokenLowMailing === true && (sent50 또는 sent10 === false) 스캔
 * - 잔량 < 50% / < 10% 이면 해당 임계값 메일 (Active admin 복수)
 * - 발송 후 tokenLowMailingSent50/10ThisWindow = true (윈도우 리셋 시 false)
 * - tenants.language 기준 다국어 메일 (Resend)
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