/**
 * Cloud Tasks 전용 인제스트 HTTP 함수.
 *
 * 배포 전 운영 설정:
 * - Cloud Tasks 발신 서비스 계정에 iam.serviceAccounts.actAs가 필요합니다.
 * - Qdrant가 사설망에 있으면 최초 배포 후 Direct VPC egress
 *   (network/subnet, private-ranges-only)를 설정합니다.
 */
const _onRequest = require("@/_onRequest");
const ApiError = require("@/errors/apiError");
const { runIngest, classifyIngestError } = require("@/ingest/ingestCore");

const nonEmptyString = { type: "string", minLength: 1 };

const ingestWorker = _onRequest({
  opts: {
    timeoutSeconds: 1200,
    // JSONL, 임베딩 배치 및 Qdrant point 변환이 동시에 메모리에 존재할 수 있습니다.
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
  // Cloud Tasks OIDC로 호출. x-health-check GET은 workerTask와 동일하게 통과.
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
        // 본문에는 내부 URL, 원인 메시지 등 민감할 수 있는 값을 넣지 않습니다.
        throw new ApiError({
          errorCode: classification.code,
          message: "Ingest temporarily unavailable.",
          httpStatusCode: 503,
          returnToUser: true
        });
      }

      // FAILED 기록 또는 작업 소유권 변경을 Firestore에서 안전하게 확인한 경우에만
      // 비재시도 오류를 2xx로 ack합니다. 상태 처리가 실패하면 재시도를 요청합니다.
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
