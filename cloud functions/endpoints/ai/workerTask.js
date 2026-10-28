/**
 * ============================================================================
 * workerTask.js - Worker Cloud Function called by Cloud Tasks
 * ============================================================================
 *
 * Cloud Function called by Cloud Tasks to run Cloud Run Job.
 * Processes tasks enqueued via Cloud Tasks from uploadDataset.js.
 *
 * Key features:
 * 1. Called from Cloud Tasks with OIDC token
 * 2. Runs Cloud Run Job to trigger worker.js
 * 3. Ensures sequential execution (per queue settings)
 *
 * ⚠️ Authentication method
 * - Called from Cloud Tasks with OIDC token
 * - Cloud Function uses Bearer token when calling Cloud Run Job API
 * - Cloud Function's service account needs Cloud Run Job execution permission
 *   (roles/run.invoker or roles/run.admin)
 *
 * ✅ Environment variables
 * - GCP_PROJECT_ID (required)
 * - JOB_REGION (required, Cloud Run Job region)
 *
 * ⏱️ Cloud Run Job timeout setting
 * - Timeout is set when creating/updating Cloud Run Job.
 * - Current setting: 20 minutes (1200 seconds) - see cloud run/deploy.sh
 * - To update timeout: gcloud run jobs update JOB_NAME --region=REGION --task-timeout=1200s
 * - Processing 10,000 records takes about 6-8 minutes, so 20-minute timeout is sufficient.
 *
 * 🌐 VPC settings
 * - Cloud Run Job accesses Qdrant via Direct VPC egress (see cloud run/deploy.sh)
 * - This Cloud Function (workerTask) only calls Cloud Run Jobs API, so no VPC setup needed.
 * ============================================================================
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { logInfo, logAndCaptureError, markErrorCaptured, shouldCaptureError } = require("@/utils/logger");
const { AppConfig } = require("@/const/AppConfig");
const { GoogleAuth } = require("google-auth-library");

/**
 * Issue Google Cloud authentication token
 */
async function getAccessTokenForJobs() {
  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // Handle version compatibility: support both string and object formats.
    let tokenString;
    if (typeof accessToken === "string") {
      tokenString = accessToken;
    } else if (accessToken && accessToken.token) {
      tokenString = accessToken.token;
    } else {
      throw new Error("Failed to get access token: invalid format");
    }

    if (!tokenString) {
      throw new Error("Failed to get access token: token is empty");
    }

    return { token: tokenString };
  } catch (error) {
    logAndCaptureError(
      error instanceof Error ? error : new Error(String(error)),
      "[workerTask] Failed to get access token",
      {
        tenant_id: "system",
        function_name: "getAccessTokenForJobs"
      }
    );
    throw markErrorCaptured(
      new Error(
        `Google Cloud 인증 토큰을 가져오는데 실패했습니다: ${error.message}`
      )
    );
  }
}

/**
 * Run Cloud Run Job
 */
async function executeCloudRunJob(payload, tenantId) {
  const projectId = AppConfig.GCP_PROJECT_ID;
  const jobRegion = AppConfig.JOB_REGION;
  const jobName = AppConfig.JOB_NAME; // Use fixed value (security: job_name cannot be set externally)

  if (!projectId || !jobRegion || !jobName) {
    throw new ApiError({
      errorCode: "MISSING_CONFIG",
      message: "GCP_PROJECT_ID, JOB_REGION, 또는 JOB_NAME이 없습니다.",
      httpStatusCode: 500,
      returnToUser: true
    });
  }

  const runJobsApiUrl = `https://${jobRegion}-run.googleapis.com/v2/projects/${projectId}/locations/${jobRegion}/jobs/${jobName}:run`;

  const tokenResult = await getAccessTokenForJobs();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${tokenResult.token}`
  };

  logInfo("[workerTask] Executing Cloud Run Job", {
    tenant_id: tenantId || "unknown",
    function_name: "executeCloudRunJob",
    extra: {
      job_name: jobName,
      job_region: jobRegion,
      project_id: projectId
    }
  });

  const response = await fetch(runJobsApiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorResult;
    try {
      errorResult = errorText ? JSON.parse(errorText) : { ok: false };
    } catch {
      errorResult = { raw: errorText };
    }

    logAndCaptureError(
      new Error(`Cloud Run Job 실행 실패: ${response.status}`),
      "[workerTask] Cloud Run Job execution failed",
      {
        tenant_id: tenantId || "unknown",
        function_name: "executeCloudRunJob",
        extra: {
          job_name: jobName,
          job_region: jobRegion,
          project_id: projectId,
          status: response.status,
          error_result: errorResult
        }
      }
    );

    throw markErrorCaptured(
      new Error(
        `Cloud Run Job 실행 실패: ${response.status} ${JSON.stringify(errorResult)}`
      )
    );
  }

  const result = await response.json();

  logInfo("[workerTask] Cloud Run Job executed successfully", {
    tenant_id: tenantId || "unknown",
    function_name: "executeCloudRunJob",
    extra: {
      job_name: jobName,
      execution_name: result.name
    }
  });

  return result;
}

const workerTask = _onRequest({
  opts: {
    timeoutSeconds: 540, // Allow delay for Run Job API and authentication (function does not wait for job completion)
    memory: "256MiB"
  },
  params: {
    type: PropertyType.OBJECT,
    properties: {
      overrides: {
        type: PropertyType.OBJECT,
        description: "Cloud Run Job 실행 옵션 (containerOverrides 포함)"
      }
    },
    required: ["overrides"],
    additionalProperties: true
  },
  enableSecurityFilter: false, // Security filter disabled because called from Cloud Tasks with OIDC token
  handler: async (req, res) => {
    const { overrides } = req.body;

    if (!overrides || !overrides.containerOverrides) {
      throw new ApiError({
        errorCode: "INVALID_PAYLOAD",
        message: "overrides.containerOverrides가 필요합니다.",
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    // Extract tenant ID (for logging)
    const tenantId = overrides.containerOverrides[0]?.env?.find(
      (e) => e.name === "TENANT"
    )?.value || "unknown";

    try {
      const payload = {
        overrides
      };

      const result = await executeCloudRunJob(payload, tenantId);

      return {
        success: true,
        jobExecution: result
      };
    } catch (error) {
      if (shouldCaptureError(error)) {
        logAndCaptureError(
          error instanceof Error ? error : new Error(String(error)),
          "[workerTask] Error",
          {
            tenant_id: tenantId,
            function_name: "workerTask",
            extra: {
              error_message: error?.message || String(error)
            }
          }
        );
      }

      throw new ApiError({
        errorCode: "JOB_EXECUTION_FAILED",
        message: `Cloud Run Job 실행 실패: ${error.message}`,
        httpStatusCode: 500
      });
    }
  }
});

module.exports = workerTask;