/**
 * arsMappingWorker — Cloud Tasks target; runs ARS Pass A/B/C.
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const { runArsMappingJob } = require("@/utils/arsMappingCore");
const { logInfo } = require("@/utils/logger");

module.exports = _onRequest({
  opts: {
    memory: "2GiB",
    // Gen2 HTTPS max 3600s; keep aligned with Cloud Tasks dispatchDeadline (max 1800s).
    timeoutSeconds: 1800,
    // Cloud Tasks / internal — no browser CORS needed; allow for health
    cors: false
  },
  // Cloud Tasks posts plain JSON (same as ingestWorker). Do not AES-decrypt.
  enableSecurityFilter: false,
  requireCredential: false,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      dataset: { type: PropertyType.STRING },
      force_full: { type: PropertyType.BOOLEAN },
      changed_row_ids: {
        type: [PropertyType.ARRAY, "null"],
        items: { type: PropertyType.STRING }
      },
      job_id: { type: PropertyType.STRING }
    },
    required: ["tenant", "dataset"],
    additionalProperties: true
  },
  handler: async (req) => {
    const tenant = String(req.body.tenant || "").trim();
    const dataset = String(req.body.dataset || req.body.dataset_id || "").trim();
    const force_full = req.body.force_full === true;
    const changed_row_ids = Array.isArray(req.body.changed_row_ids)
      ? req.body.changed_row_ids.map(String)
      : null;

    logInfo("[arsMappingWorker] start", {
      tenant_id: tenant,
      function_name: "arsMappingWorker",
      extra: {
        step: "worker_start",
        dataset_id: dataset,
        force_full,
        changed_row_ids: Array.isArray(changed_row_ids) ? changed_row_ids.length : 0
      }
    });

    const result = await runArsMappingJob({
      tenantId: tenant,
      datasetId: dataset,
      forceFull: force_full,
      changedRowIds: changed_row_ids
    });

    return { success: true, ...result };
  }
});
