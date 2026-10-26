/**
 * runStatuspageHealthCheck.js - Statuspage 헬스 체크 수동 실행 API
 *
 * scheduler/statuspageHealthCheck.js 와 동일한 로직을 HTTP POST로 실행합니다.
 * Firebase ID Token (Authorization: Bearer) 필요.
 *
 * GET warm-up / health probe (_onRequest 공통):
 * - wake-up 헤더 → 204 (wakeUpInstances 등)
 * - x-health-check 헤더 → 200 { status: "ok" }
 * 헤더 없는 GET은 인증 오류로 거부됩니다 (본문 로직 미실행).
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const { runStatuspageHealthCheck } = require("@/utils/runStatuspageHealthCheck");

module.exports = _onRequest({
  opts: {
    timeoutSeconds: 600,
    cpu: "gcf_gen1",
    memory: "256MiB"
  },
  enableSecurityFilter: false,
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      skip_statuspage_update: { type: PropertyType.BOOLEAN }
    },
    required: [],
    additionalProperties: false
  },
  handler: async (req) => {
    const skipStatuspageUpdate = req.body?.skip_statuspage_update === true;
    const result = await runStatuspageHealthCheck({
      functionName: "runStatuspageHealthCheck",
      skipStatuspageUpdate
    });
    return {
      status: "ok",
      triggered_by: req.auth?.email || req.auth?.uid || null,
      ...result
    };
  }
});