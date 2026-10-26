/**
 * ============================================================================
 * responseSummaryNotifications.js — 전날 응답(대화) 일일 요약 메일
 * ============================================================================
 *
 * - 매일 09:00 Asia/Seoul 실행 (= UTC 00:00, 직전 UTC 일자 마감 직후)
 * - 요약 대상: UTC 어제 (usage_daily / analytics dateKey 와 동일)
 * - alarm.responseSummaryMailing === true 테넌트
 * - 하루 1회 (responseSummaryMailingLastSentDateKey)
 * - 수신: Active admin 멤버 email (복수), locale: tenant.language
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