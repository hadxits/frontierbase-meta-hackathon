/**
 * ============================================================================
 * workerTask.js - Cloud Tasks에서 호출되는 Worker Cloud Function
 * ============================================================================
 *
 * Cloud Tasks에서 호출되어 Cloud Run Job을 실행하는 Cloud Function입니다.
 * uploadDataset.js에서 Cloud Tasks를 통해 enqueue된 작업을 처리합니다.
 *
 * 주요 특징:
 * 1. Cloud Tasks에서 OIDC 토큰으로 호출됨
 * 2. Cloud Run Job을 실행하여 worker.js를 트리거
 * 3. 순차 실행 보장 (Queue 설정에 따라)
 *
 * ⚠️ 인증 방식
 * - Cloud Tasks에서 OIDC 토큰으로 호출됨
 * - Cloud Function은 Cloud Run Job API를 호출할 때 Bearer 토큰 사용
 * - Cloud Function 실행 서비스 계정이 Cloud Run Job 실행 권한 필요
 *   (roles/run.invoker 또는 roles/run.admin)
 *
 * ✅ 환경변수
 * - GCP_PROJECT_ID (필수)
 * - JOB_REGION (필수, Cloud Run Job 리전)
 *
 * ⏱️ Cloud Run Job Timeout 설정
 * - Cloud Run Job의 timeout은 Job 생성/업데이트 시 설정됩니다.
 * - 현재 설정: 20분 (1200초) - cloud run/deploy.sh 참고
 * - Timeout 업데이트: gcloud run jobs update JOB_NAME --region=REGION --task-timeout=1200s
 * - 10,000 레코드 처리 시 약 6-8분 소요되므로 20분 timeout으로 여유있게 처리 가능
 *
 * 🌐 VPC 설정
 * - Cloud Run Job은 Direct VPC egress로 Qdrant에 접근합니다 (cloud run/deploy.sh 참고)
 * - 이 Cloud Function(workerTask)은 Cloud Run Jobs API만 호출하므로 VPC 설정 불필요
 * ============================================================================
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { logInfo, logAndCaptureError, markErrorCaptured, shouldCaptureError } = require("@/utils/logger");
const { AppConfig } = require("@/const/AppConfig");
const { GoogleAuth } = require("google-auth-library");

/**
 * Google Cloud 인증 토큰 발급
 */
async function getAccessTokenForJobs() {
  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // 버전 호환성 처리: 문자열 또는 객체 형태 모두 지원
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
 * Cloud Run Job 실행
 */
async function executeCloudRunJob(payload, tenantId) {
  const projectId = AppConfig.GCP_PROJECT_ID;
  const jobRegion = AppConfig.JOB_REGION;
  const jobName = AppConfig.JOB_NAME; // 고정값 사용 (보안: 외부에서 job_name 지정 불가)

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
    timeoutSeconds: 540, // Run Job API·인증 지연 대비 여유 (함수는 Job 완료를 기다리지 않음)
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
  enableSecurityFilter: false, // Cloud Tasks에서 OIDC 토큰으로 호출되므로 보안 필터 비활성화
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

    // tenant ID 추출 (로깅용)
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