/**
 * ============================================================================
 * cloudRunHealthCheck.js - Wrapper API for Cloud Run Job health checks.
 * ============================================================================
 *
 * Called by Cloud Monitoring Uptime Check / statuspageHealthCheck endpoint,
 * internally GETs the Job resource metadata via Cloud Run Jobs API.
 * Checks if the Job exists and is accessible; does not run the Job.
 *
 * On temporary Run API errors (503 etc), retry up to 10 times with increasing intervals (10s, 20s, ...).
 * On success after retries, send one Sentry info message (no Cloud Logging added).
 *
 * - No tenant, LLM, or actual job calls involved.
 * - Requires GCP Run API permissions (roles/run.viewer or run.admin).
 * ============================================================================
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { logInfo, logWarn, logAndCaptureError, markErrorCaptured } = require("@/utils/logger");
const { captureMessage } = require("@/utils/sentry");
const { sleep } = require("@/utils/sleep");
const { AppConfig } = require("@/const/AppConfig");
const { GoogleAuth } = require("google-auth-library");

const MAX_ATTEMPTS = 10;
const RETRY_DELAY_STEP_MS = 10 * 1000;
const RUN_API_FETCH_TIMEOUT_MS = 20 * 1000;

function assertCloudRunJobConfig() {
  const projectId = AppConfig.GCP_PROJECT_ID;
  const jobRegion = AppConfig.JOB_REGION;
  const jobName = AppConfig.JOB_NAME;
  if (!projectId || !jobRegion || !jobName) {
    throw new ApiError({
      errorCode: "MISSING_CONFIG",
      message: "GCP_PROJECT_ID, JOB_REGION, JOB_NAME이 없습니다.",
      httpStatusCode: 503
    });
  }
  return { projectId, jobRegion, jobName };
}

async function getAccessToken() {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  const tokenString =
    typeof accessToken === "string"
      ? accessToken
      : accessToken?.token;
  if (!tokenString) {
    throw new Error("Failed to get access token");
  }
  return tokenString;
}

/**
 * Fetch Cloud Run Job metadata once (do not run). Throw on failure without sending to Sentry.
 * @param {string} accessToken
 */
async function fetchCloudRunJobMetadataOnce(accessToken) {
  const { projectId, jobRegion, jobName } = assertCloudRunJobConfig();
  const url = `https://${jobRegion}-run.googleapis.com/v2/projects/${projectId}/locations/${jobRegion}/jobs/${jobName}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RUN_API_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError({
        errorCode: "CLOUD_RUN_UNREACHABLE",
        message: "Cloud Run Job 리소스를 확인할 수 없습니다.",
        httpStatusCode: response.status >= 500 ? response.status : 503,
        data: { status: response.status, body: text }
      });
    }

    return response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof ApiError) {
      throw err;
    }
    if (err?.name === "AbortError") {
      throw new ApiError({
        errorCode: "RUN_API_TIMEOUT",
        message: "Cloud Run Job API 요청 시간이 초과되었습니다.",
        httpStatusCode: 503,
        data: { timeout_ms: RUN_API_FETCH_TIMEOUT_MS }
      });
    }
    throw err;
  }
}

/**
 * On Run API failure, retry up to MAX_ATTEMPTS times with 10s, 20s, ... intervals.
 * @returns {Promise<{ metadata: object, attempt: number }>}
 */
async function getCloudRunJobMetadata() {
  assertCloudRunJobConfig();
  const accessToken = await getAccessToken();

  let lastError = null;
  let lastFailureExtra = {};

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const metadata = await fetchCloudRunJobMetadataOnce(accessToken);
      if (attempt > 1) {
        captureMessage(
          "[cloudRunHealthCheck] Cloud Run Job check succeeded after retries",
          "info",
          {
            tenant_id: "system",
            function_name: "cloudRunHealthCheck",
            extra: {
              job: AppConfig.JOB_NAME,
              attempt,
              failures_before_success: attempt - 1
            }
          }
        );
      }
      return { metadata, attempt };
    } catch (err) {
      lastError = err;
      if (err instanceof ApiError && err.errorCode === "MISSING_CONFIG") {
        throw err;
      }

      lastFailureExtra = {
        attempt,
        error_code: err instanceof ApiError ? err.errorCode : err?.name || "UNKNOWN",
        message: err?.message || String(err),
        ...(err instanceof ApiError && err.data ? err.data : {})
      };

      if (attempt >= MAX_ATTEMPTS) {
        break;
      }

      const delayMs = attempt * RETRY_DELAY_STEP_MS;
      logWarn("[cloudRunHealthCheck] Cloud Run Job GET failed, retry scheduled", {
        tenant_id: "system",
        function_name: "cloudRunHealthCheck",
        extra: {
          ...lastFailureExtra,
          max_attempts: MAX_ATTEMPTS,
          retry_in_ms: delayMs
        }
      });
      await sleep(delayMs);
    }
  }

  logAndCaptureError(
    lastError instanceof Error ? lastError : new Error(String(lastError)),
    "[cloudRunHealthCheck] Cloud Run Job GET failed after all retries",
    {
      tenant_id: "system",
      function_name: "cloudRunHealthCheck",
      extra: {
        ...lastFailureExtra,
        max_attempts: MAX_ATTEMPTS
      }
    }
  );
  throw markErrorCaptured(
    lastError instanceof ApiError
      ? lastError
      : new ApiError({
          errorCode: "CLOUD_RUN_UNREACHABLE",
          message: "Cloud Run Job 리소스를 확인할 수 없습니다.",
          httpStatusCode: 503
        })
  );
}

const cloudRunHealthCheck = _onRequest({
  opts: {
    timeoutSeconds: 540,
    memory: "256MiB",
    cpu: "gcf_gen1"
  },
  params: {
    type: PropertyType.OBJECT,
    properties: {},
    required: [],
    additionalProperties: true
  },
  enableSecurityFilter: false,
  handler: async (_req, _res) => {
    const { attempt } = await getCloudRunJobMetadata();
    if (attempt === 1) {
      logInfo("[cloudRunHealthCheck] Cloud Run Job reachable", {
        tenant_id: "system",
        function_name: "cloudRunHealthCheck",
        extra: { job: AppConfig.JOB_NAME }
      });
    }
    return {
      status: "ok",
      cloudRun: "reachable"
    };
  }
});

module.exports = cloudRunHealthCheck;