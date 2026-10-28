// Common application configuration constants

/** Common GCP region for Cloud Functions, Cloud Run Job, Cloud Tasks queue */
const GCP_REGION = "us-central1";

const AppConfig = {
  // Embedding model
  DEFAULT_EMBED_MODEL: "text-embedding-3-small",

  /** OpenAI lightweight model (classification, transformation, simple chat, summarization) */
  DEFAULT_OPENAI_LITE_MODEL: "gpt-4.1-mini",

  /** OpenAI pre-stream lightweight (gpt-5.4-nano deprecated → gpt-5.6-luna) — transform/rerank/semantic classification */
  DEFAULT_OPENAI_PRESTREAM_MODEL: "gpt-5.6-luna",

  // GCP project ID
  GCP_PROJECT_ID: "frontierbase-console",

  GCP_REGION,

  // Cloud Run Job (ingest-worker-job)
  JOB_REGION: GCP_REGION,

  // Cloud Run Job name (fixed)
  // Use the same Job; tenant/dataset info passed via environment variables
  // Match Cloud Tasks Queue max-concurrent-dispatches (limit for concurrent ingest-worker execution)
  JOB_NAME: "ingest-worker-job",

  /** worker-queue concurrent dispatch count (= target concurrent ingest-worker-job execution) */
  WORKER_MAX_CONCURRENT_DISPATCHES: 5
};

module.exports = {
  AppConfig,
  GCP_REGION,
};