/**
 * ============================================================================
 * statuspageHealthCheck.js — health check every 10 minutes and send component status to Statuspage.io.
 * ============================================================================
 *
 * Common logic: utils/runStatuspageHealthCheck.js.
 * Manual run: endpoints/health/runStatuspageHealthCheck.js.
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