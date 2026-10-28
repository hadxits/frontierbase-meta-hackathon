const _onRequest = require("@/_onRequest");
const { consoleParams, assertAccess, startMuseJob } = require("@/utils/arsMuseJobs");

module.exports = _onRequest({
  opts: { memory: "512MiB", timeoutSeconds: 60, maxInstances: 4 },
  requireCredential: true,
  params: consoleParams,
  handler: async (req) => {
    await assertAccess(req);
    return startMuseJob(req.body.tenant, req.body.dataset_id);
  }
});
