/**
 * runStatuspageHealthCheck.js - Manual execution API for Statuspage health check.
 *
 * Runs the same logic as scheduler/statuspageHealthCheck.js via HTTP POST.
 * Requires Firebase ID Token (Authorization: Bearer).
 *
 * GET warm-up / health probe (_onRequest common):
 * - wake-up header → 204 (wakeUpInstances etc).
 * - x-health-check header → 200 { status: "ok" }.
 * GET requests without these headers are rejected with auth error (main logic not executed).
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