const _onRequest = require("@/_onRequest");
const environment = require("@/env");
const { consoleParams, runMuseJob } = require("@/utils/arsMuseJobs");

module.exports = _onRequest({
  opts: {
    memory: "2GiB",
    timeoutSeconds: 1800,
    maxInstances: 2,
    concurrency: 1,
    cors: false,
    invoker: environment.CLOUD_TASKS_SERVICE_ACCOUNT
      ? [environment.CLOUD_TASKS_SERVICE_ACCOUNT]
      : "private"
  },
  enableSecurityFilter: false,
  params: {
    type: "object",
    properties: {
      ...consoleParams.properties,
      job_id: { type: "string", pattern: "^[a-f0-9-]{36}$" }
    },
    required: ["tenant", "dataset_id", "job_id"],
    additionalProperties: false
  },
  handler: (req) => runMuseJob(req.body.tenant, req.body.dataset_id, req.body.job_id)
});
