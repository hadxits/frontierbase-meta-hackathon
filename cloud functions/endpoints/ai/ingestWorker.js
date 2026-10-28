/**
 * Cloud Tasks dedicated ingest HTTP function.
 *
 * Pre-deployment operational settings:
 * - Cloud Tasks caller service account needs iam.serviceAccounts.actAs permission.
 * - If Qdrant is on a private network, set Direct VPC egress after initial deployment
 *   (network/subnet, private-ranges-only).
 */
const _onRequest = require("@/_onRequest");
const ApiError = require("@/errors/apiError");
const { runIngest, classifyIngestError } = require("@/ingest/ingestCore");

const nonEmptyString = { type: "string", minLength: 1 };

const ingestWorker = _onRequest({
  opts: {
    timeoutSeconds: 1200,
    // JSONL, embedding batches, and Qdrant point conversions may coexist in memory.
    memory: "2GiB",
    cpu: 2,
    concurrency: 1,
    maxInstances: 5,
    minInstances: 0
  },
  params: {
    type: "object",
    properties: {
      job_id: { ...nonEmptyString, maxLength: 500 },
      tenant: { ...nonEmptyString, maxLength: 256 },
      dataset: { ...nonEmptyString, maxLength: 256 },
      gcs_path: {
        ...nonEmptyString,
        maxLength: 2048,
        pattern: "^gs://[^/]+/.+"
      },
      full_gcs_path: {
        ...nonEmptyString,
        maxLength: 2048,
        pattern: "^gs://[^/]+/.+"
      },
      qdrant_url: { ...nonEmptyString, maxLength: 2048 },
      embed_model: { ...nonEmptyString, maxLength: 256 },
      vector_size: {
        type: "integer",
        minimum: 1,
        maximum: 100000
      },
      dataset_locale: {
        type: "string",
        minLength: 1,
        maxLength: 16,
        pattern: "^[A-Za-z_-]+$"
      }
    },
    required: [
      "job_id",
      "tenant",
      "dataset",
      "gcs_path",
      "qdrant_url",
      "embed_model",
      "vector_size"
    ]
  },
  // Called via Cloud Tasks OIDC. x-health-check GET passes same as workerTask.
  enableSecurityFilter: false,
  handler: async (req) => {
    const payload = req.body;

    try {
      const result = await runIngest({
        jobId: payload.job_id,
        tenant: payload.tenant,
        datasetId: payload.dataset,
        gcsPath: payload.gcs_path,
        fullGcsPath: payload.full_gcs_path,
        qdrantUrl: payload.qdrant_url,
        embedModel: payload.embed_model,
        vectorSize: payload.vector_size,
        datasetLocale: payload.dataset_locale
      });

      return {
        outcome: result?.outcome || "completed",
        skipped: result?.skipped === true,
        job_id: payload.job_id
      };
    } catch (error) {
      const classification = classifyIngestError(error);
      if (classification.retryable) {
        // Do not include sensitive values like internal URLs or error messages in the body.
        throw new ApiError({
          errorCode: classification.code,
          message: "Ingest temporarily unavailable.",
          httpStatusCode: 503,
          returnToUser: true
        });
      }

      // Only acknowledge non-retry errors with 2xx if FAILED record or task ownership change is safely confirmed in Firestore.
      // If status update fails, request retry.
      if (error?.statusHandled !== true) {
        throw new ApiError({
          errorCode: "INGEST_FAILURE_STATE_UNCONFIRMED",
          message: "Ingest failure state could not be confirmed.",
          httpStatusCode: 503,
          returnToUser: true
        });
      }

      return {
        outcome: "failed",
        retryable: false,
        failure_state_handled: true,
        error_code: classification.code,
        job_id: payload.job_id
      };
    }
  }
});

module.exports = ingestWorker;
