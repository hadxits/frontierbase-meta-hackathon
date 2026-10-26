/**
 * ============================================================================
 * unansweredSummaryNotifications.js — 전날 미답변 일일 요약 메일
 * ============================================================================
 *
 * - 매일 09:00 Asia/Seoul 실행 (= UTC 00:00, 직전 UTC 일자 마감 직후)
 * - 요약 대상: UTC 어제
 * - alarm.unansweredSummaryMailing === true 테넌트
 * - 하루 1회 (unansweredSummaryMailingLastSentDateKey)
 * - 대용량: 총건수 + 유형 집계 + 질문 미리보기 top-N
 * - 수신: Active admin 멤버 email (복수), locale: tenant.language
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