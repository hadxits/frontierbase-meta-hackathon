/**
 * ============================================================================
 * statuspageHealthCheck.js - 10분 주기 헬스 체크 + Statuspage.io 컴포넌트 상태 전송
 * ============================================================================
 *
 * 공통 로직: utils/runStatuspageHealthCheck.js
 * 수동 실행: endpoints/health/runStatuspageHealthCheck.js
 * ============================================================================
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runStatuspageHealthCheck } = require("@/utils/runStatuspageHealthCheck");

const statuspageHealthCheck = onSchedule(
  {
    schedule: "*/10 * * * *",
    timeZone: "Asia/Seoul",
    timeoutSeconds: 540,
    cpu: "gcf_gen1"
  },
  async () => {
    await runStatuspageHealthCheck({ functionName: "statuspageHealthCheck" });
  }
);

module.exports = statuspageHealthCheck;