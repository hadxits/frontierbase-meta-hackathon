const { AppConfig } = require("../const/AppConfig");

// ingestWorker actual times: line 1 ~2.3s, line 89 ~2.5s (warm, no queue).
// Embedding batch 64, upsert batch 200. Job path adds ~150s for Direct VPC startup.

function estimateIngestCompletionSeconds({
  rowsToEmbed = 0,
  rowsToDelete = 0,
  pendingTasksCount = 1,
  useDirectFunction = Boolean(process.env.INGEST_FUNCTION_URL)
} = {}) {
  const embedRows = Math.max(0, Number(rowsToEmbed) || 0);
  const deleteRows = Math.max(0, Number(rowsToDelete) || 0);
  const pending = Math.max(0, Number(pendingTasksCount) || 0);

  const workSec = Math.max(
    5,
    Math.ceil(
      4 +
        Math.ceil(embedRows / 64) * 0.8 +
        Math.ceil(embedRows / 200) * 0.25 +
        Math.ceil(deleteRows / 200) * 0.4
    )
  );

  const concurrent = AppConfig.WORKER_MAX_CONCURRENT_DISPATCHES || 5;
  const ahead = Math.max(0, pending - 1);
  const waves = Math.ceil(ahead / concurrent);
  const otherJobSec = Math.min(60, Math.max(15, workSec));
  const startSec = useDirectFunction ? 5 : 150;

  return Math.min(20 * 60, startSec + waves * otherJobSec + workSec);
}

module.exports = { estimateIngestCompletionSeconds };
