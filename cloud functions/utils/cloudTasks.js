/**
 * ============================================================================
 * cloudTasks.js - Cloud Tasks 관련 공통 유틸리티
 * ============================================================================
 *
 * Cloud Tasks Queue에 작업을 enqueue하는 공통 함수를 제공합니다.
 *
 * ⚠️ 동시 실행 (GCP 큐 설정):
 * - max-concurrent-dispatches=AppConfig.WORKER_MAX_CONCURRENT_DISPATCHES (현재 5)
 *   → 새 경로에서는 ingestWorker 실행 상한, legacy 경로에서는 Job execution 상한
 * - 같은 dataset 동시 인덱싱은 ingestCore의 processing_job_id로 방지
 * ============================================================================
 */
const { GoogleAuth } = require("google-auth-library");
const crypto = require("crypto");
const environment = require("@/env");
const { AppConfig } = require("@/const/AppConfig");
const { logInfo, logAndCaptureError, logOperationalWarn } = require("@/utils/logger");

// ============================================================================
// Cloud Tasks API 설정
// ============================================================================
const CLOUD_TASKS_API_BASE = "https://cloudtasks.googleapis.com/v2";
const CLOUD_TASKS_API_BASE_V2BETA3 = "https://cloudtasks.googleapis.com/v2beta3";

/**
 * Google Cloud 인증 토큰 발급
 * @returns {Promise<string>} Access token
 */
async function getAccessToken() {
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

    return tokenString;
  } catch (error) {
    logAndCaptureError(
      error instanceof Error ? error : new Error(String(error)),
      "[cloudTasks] Failed to get access token",
      {
        tenant_id: "system",
        function_name: "getAccessToken"
      }
    );
    throw new Error(
      `Google Cloud 인증 토큰을 가져오는데 실패했습니다: ${error.message}`
    );
  }
}

/**
 * Cloud Tasks Queue에 작업 추가
 *
 * @param {Object} params
 * @param {string} params.projectId - GCP 프로젝트 ID
 * @param {string} params.location - GCP 리전 (예: us-central1)
 * @param {string} params.queueName - Cloud Tasks 큐 이름
 * @param {string} params.jobUrl - Cloud Function worker.js URL
 * @param {Object} params.payload - Cloud Function에 전달할 payload
 * @param {string} params.serviceAccountEmail - OIDC 토큰 생성용 서비스 계정 이메일 (필수)
 * @param {string} params.taskName - Task 이름 (중복 방지용)
 * @param {string} [params.dispatchDeadline] - HTTP dispatch deadline (예: "1250s")
 * @param {string} [params.tenantId] - 테넌트 ID (로깅용)
 * @returns {Promise<Object>} 생성된 작업 정보
 */
async function enqueueTask({
  projectId,
  location,
  queueName,
  jobUrl,
  payload,
  serviceAccountEmail,
  taskName,
  dispatchDeadline,
  tenantId = null
}) {
  const queuePath = `projects/${projectId}/locations/${location}/queues/${queueName}`;
  const url = `${CLOUD_TASKS_API_BASE}/${queuePath}/tasks`;

  const httpRequest = {
    httpMethod: "POST",
    url: jobUrl,
    headers: {
      "Content-Type": "application/json"
    },
    body: Buffer.from(JSON.stringify(payload)).toString("base64")
  };

  // OIDC 토큰 필수
  if (!serviceAccountEmail) {
    throw new Error(
      "CLOUD_TASKS_SERVICE_ACCOUNT 환경변수가 필요합니다. OIDC 토큰을 사용해야 합니다."
    );
  }

  httpRequest.oidcToken = {
    serviceAccountEmail,
    // 이 모듈이 토큰을 검증하는 것은 아닙니다. Cloud Run IAM이 검증할 audience를
    // 대상 URL과 일치시키도록 Cloud Tasks에 OIDC 토큰 발급을 요청합니다.
    audience: jobUrl
  };

  // Task name 지정 (중복 방지)
  const task = { httpRequest };
  if (taskName) {
    task.name = `${queuePath}/tasks/${taskName}`;
  }
  if (dispatchDeadline) {
    if (!/^\d+(?:\.\d+)?s$/.test(dispatchDeadline)) {
      throw new Error("dispatchDeadline must be a protobuf Duration string in seconds");
    }
    task.dispatchDeadline = dispatchDeadline;
  }

  // Access token 가져오기
  const accessToken = await getAccessToken();

  logInfo("[cloudTasks] Enqueue request", {
    tenant_id: tenantId || "system",
    function_name: "enqueueTask",
    extra: {
      queue_path: queuePath,
      job_url: jobUrl,
      task_name: taskName,
      project_id: projectId,
      location,
      queue_name: queueName
    }
  });

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ task })
    });
  } catch (fetchError) {
    const fetchErrMsg = `[cloudTasks] Enqueue failed (fetch threw) | job_url=${jobUrl} | queue=${queueName} | err=${(fetchError?.message || String(fetchError)).slice(0, 300)}`;
    logAndCaptureError(
      fetchError instanceof Error ? fetchError : new Error(String(fetchError)),
      fetchErrMsg,
      {
        tenant_id: tenantId || "system",
        function_name: "enqueueTask",
        extra: {
          queue_path: queuePath,
          job_url: jobUrl,
          task_name: taskName,
          fetch_error_name: fetchError?.name,
          fetch_error_code: fetchError?.code
        }
      }
    );
    throw fetchError;
  }

  if (!response.ok) {
    const errorText = await response.text();
    let errorBodyParsed = null;
    try {
      errorBodyParsed = errorText ? JSON.parse(errorText) : null;
    } catch (_) {
      // errorText가 JSON이 아니면 무시
    }

    const grpcStatus = errorBodyParsed?.error?.status;
    if (
      grpcStatus === "ALREADY_EXISTS" ||
      String(errorText || "").includes("ALREADY_EXISTS")
    ) {
      const existingName = task.name || `${queuePath}/tasks/${taskName}`;
      logInfo("[cloudTasks] Task already exists, treating as enqueued", {
        tenant_id: tenantId || "system",
        function_name: "enqueueTask",
        extra: {
          queue_path: queuePath,
          task_name: taskName,
          existing_name: existingName,
          status: response.status,
          grpc_status: grpcStatus || null
        }
      });
      return { name: existingName, alreadyExists: true };
    }

    let errorMessage = `Cloud Tasks enqueue 실패: ${response.status} ${errorText}`;

    // 404 에러인 경우 큐 생성 가이드 추가
    if (response.status === 404) {
      errorMessage += `\n\n⚠️ 큐가 존재하지 않습니다. 다음 명령어로 큐를 생성하세요:\n`;
      errorMessage += `gcloud tasks queues create ${queueName} \\\n`;
      errorMessage += `  --location=${location} \\\n`;
      errorMessage += `  --max-concurrent-dispatches=${AppConfig.WORKER_MAX_CONCURRENT_DISPATCHES} \\\n`;
      errorMessage += `  --max-dispatches-per-second=1\n\n`;
      errorMessage += `또는 환경변수를 확인하세요:\n`;
      errorMessage += `- GCP_PROJECT_ID: ${projectId}\n`;
      errorMessage += `- GCP_LOCATION: ${location}\n`;
      errorMessage += `- CLOUD_TASKS_QUEUE_NAME: ${queueName}`;
    }

    // 메시지에 핵심 정보 포함 (404 시 요청한 경로와 콘솔 큐 위치 비교용)
    const detailMsg = `[cloudTasks] Enqueue failed | status=${response.status} | queue_path=${queuePath} | job_url=${jobUrl} | error_text=${(errorText || "").slice(0, 400)}`;
    logAndCaptureError(new Error(errorMessage), detailMsg, {
      tenant_id: tenantId || "system",
      function_name: "enqueueTask",
      extra: {
        project_id: projectId,
        location,
        queue_name: queueName,
        task_name: taskName,
        job_url: jobUrl,
        queue_path: queuePath,
        status: response.status,
        status_text: response.statusText,
        error_text: errorText,
        error_body_parsed: errorBodyParsed
      }
    });

    throw new Error(errorMessage);
  }

  const result = await response.json();
  
  logInfo("[cloudTasks] Task enqueued successfully", {
    tenant_id: tenantId || "system",
    function_name: "enqueueTask",
    extra: {
      projectId,
      location,
      queueName,
      taskName,
      task_name: result.name
    }
  });

  return result;
}

/**
 * Worker 작업을 Cloud Tasks에 enqueue
 *
 * @param {Object} params
 * @param {string} params.tenant - 테넌트 ID
 * @param {string} params.dataset - 데이터셋 ID
 * @param {string} params.gcs_path - GCS 파일 경로 (실제 작업용: toAdd + toUpdate만)
 * @param {string} [params.full_gcs_path] - 전체 GCS 파일 경로 (삭제 파악용: 전체 newRows, 선택)
 * @param {string} params.qdrant_url - Qdrant URL
 * @param {string} params.embed_model - 임베딩 모델
 * @param {number} params.vector_size - 벡터 차원 (critical 값, 예: 1536, 3072)
 * @param {string} params.project_id - GCP 프로젝트 ID
 * @param {string} [params.dataset_locale] - 테넌트 언어(ko, en, …). worker의 dataset.error 다국어용
 * @param {string} [params.job_id] - 호출자가 미리 만든 작업 ID
 * @param {string} [params.taskName] - 호출자가 미리 만든 Cloud Tasks task ID
 * @returns {Promise<Object>} enqueue 결과
 */
async function enqueueWorkerTask({
  tenant,
  dataset: datasetId,
  gcs_path,
  full_gcs_path,
  qdrant_url,
  embed_model,
  vector_size,
  project_id,
  dataset_locale,
  job_id,
  taskName: requestedTaskName
}) {
  const location = environment.GCP_LOCATION;
  const queueName = environment.CLOUD_TASKS_QUEUE_NAME;
  const ingestFunctionUrl = environment.INGEST_FUNCTION_URL;
  const legacyWorkerFunctionUrl = environment.WORKER_FUNCTION_URL;
  const workerFunctionUrl = ingestFunctionUrl || legacyWorkerFunctionUrl;
  const serviceAccountEmail = environment.CLOUD_TASKS_SERVICE_ACCOUNT;

  if (!location || !queueName || !workerFunctionUrl || !serviceAccountEmail) {
    const msg = `필수 환경변수가 없습니다: GCP_LOCATION=${location || "undefined"}, CLOUD_TASKS_QUEUE_NAME=${queueName || "undefined"}, INGEST_FUNCTION_URL/WORKER_FUNCTION_URL=${workerFunctionUrl ? "configured" : "undefined"}, CLOUD_TASKS_SERVICE_ACCOUNT=${serviceAccountEmail || "undefined"}`;
    logAndCaptureError(new Error(msg), "[cloudTasks] enqueueWorkerTask env validation failed", {
      tenant_id: tenant,
      function_name: "enqueueWorkerTask",
      extra: {
        has_location: !!location,
        has_queueName: !!queueName,
        has_ingestFunctionUrl: !!ingestFunctionUrl,
        has_legacyWorkerFunctionUrl: !!legacyWorkerFunctionUrl,
        has_serviceAccountEmail: !!serviceAccountEmail,
        project_id: project_id
      }
    });
    throw new Error(msg);
  }

  logInfo("[cloudTasks] enqueueWorkerTask params", {
    tenant_id: tenant,
    function_name: "enqueueWorkerTask",
    extra: {
      dataset_id: datasetId,
      gcs_path: gcs_path,
      full_gcs_path: full_gcs_path || null,
      project_id: project_id,
      location,
      queue_name: queueName,
      worker_mode: ingestFunctionUrl ? "direct_function" : "legacy_cloud_run_job",
      embed_model,
      vector_size,
      qdrant_url_present: !!qdrant_url
    }
  });

  if (
    job_id != null &&
    requestedTaskName != null &&
    String(job_id) !== String(requestedTaskName)
  ) {
    throw new Error("job_id and taskName must match when both are provided");
  }

  // 한 번 만든 ID를 Cloud Tasks 이름과 ingest job_id 양쪽에 사용합니다.
  // tenant/dataset 원문은 task 리소스 이름에 노출하지 않고 고정 길이 해시로 축약합니다.
  const subjectHash = crypto
    .createHash("sha256")
    .update(`${tenant}\0${datasetId}`)
    .digest("hex")
    .slice(0, 20);
  const generatedId =
    job_id || requestedTaskName
      ? null
      : `ingest-${subjectHash}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
  const resolvedJobId = String(job_id || requestedTaskName || generatedId);
  const isSafeTaskId = /^[A-Za-z0-9_-]{1,500}$/.test(resolvedJobId);
  if (!isSafeTaskId) {
    throw new Error(
      "job_id/taskName must be 1-500 letters, digits, hyphens, or underscores"
    );
  }
  const taskName = resolvedJobId;

  // locale은 직접 함수 payload와 legacy Job 환경변수에서 동일하게 사용합니다.
  const localeTag = String(dataset_locale ?? "en")
    .trim()
    .slice(0, 16)
    .replace(/[^a-zA-Z_-]/g, "") || "en";

  const envVars = [
    // JOB_ID는 "업로드 1건(=1 Task) 단위"로 유니크하며, Cloud Tasks delivery retry에서는 동일하게 유지됨
    // → worker.js에서 동시 실행 방지(락) 및 재시도 판별에 사용
    { name: "JOB_ID", value: resolvedJobId },
    { name: "TENANT", value: tenant },
    { name: "DATASET", value: datasetId },
    { name: "GCS_PATH", value: gcs_path }, // 실제 작업용 (toAdd + toUpdate만)
    { name: "QDRANT_URL", value: qdrant_url },
    { name: "EMBED_MODEL", value: embed_model },
    { name: "VECTOR_SIZE", value: String(vector_size) }, // 벡터 차원 (critical 값)
    { name: "DATASET_LOCALE", value: localeTag }
  ];

  // full_gcs_path가 있으면 환경변수로 추가 (삭제 파악용)
  if (full_gcs_path) {
    envVars.push({ name: "FULL_GCS_PATH", value: full_gcs_path });
  }

  const payload = ingestFunctionUrl
    ? {
        job_id: resolvedJobId,
        tenant,
        dataset: datasetId,
        gcs_path,
        ...(full_gcs_path ? { full_gcs_path } : {}),
        qdrant_url,
        embed_model,
        vector_size,
        dataset_locale: localeTag
      }
    : {
        overrides: {
          containerOverrides: [
            {
              env: envVars
            }
          ]
        }
      };

  const taskResult = await enqueueTask({
    projectId: project_id,
    location,
    queueName,
    jobUrl: workerFunctionUrl,
    payload,
    serviceAccountEmail,
    taskName,
    // Cloud Tasks HTTP deadline must exceed ingestWorker's 1200초 timeout and remain below 30분.
    dispatchDeadline: ingestFunctionUrl ? "1250s" : undefined,
    tenantId: tenant
  });
  return { ...taskResult, job_id: resolvedJobId };
}

/**
 * 큐 내 대기/처리 중인 태스크 수 추정값 조회
 * - v2beta3 사용 이유: 정식 v2 Queue 리소스에는 stats 필드가 없고, QueueStats(tasksCount)는 v2beta3에서만 제공됨
 * @param {string} projectId - GCP 프로젝트 ID
 * @param {string} location - 리전 (예: us-central1)
 * @param {string} queueName - 큐 이름
 * @returns {Promise<number|null>} tasksCount 추정값, 실패 시 null
 */
async function getQueueTaskCount(projectId, location, queueName) {
  if (!projectId || !location || !queueName) return null;
  const queuePath = `projects/${projectId}/locations/${location}/queues/${queueName}`;
  const url = `${CLOUD_TASKS_API_BASE_V2BETA3}/${queuePath}?readMask=stats`;

  try {
    const accessToken = await getAccessToken();
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) {
      await response.text(); // body 소비하여 연결/리소스 정리
      return null;
    }
    const data = await response.json();
    const count = data?.stats?.tasksCount;
    if (count === undefined || count === null) return null;
    const n = parseInt(String(count), 10);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    logOperationalWarn("[cloudTasks] getQueueTaskCount failed", {
      tenant_id: "system",
      function_name: "getQueueTaskCount",
      extra: { error: err?.message || String(err), queuePath }
    });
    return null;
  }
}

/**
 * Worker 큐(환경변수 기준)의 대기 태스크 수 조회
 * @param {string} projectId - GCP 프로젝트 ID
 * @returns {Promise<number|null>}
 */
async function getWorkerQueueTaskCount(projectId) {
  const location = environment.GCP_LOCATION;
  const queueName = environment.CLOUD_TASKS_QUEUE_NAME;
  if (!location || !queueName) return null;
  return getQueueTaskCount(projectId, location, queueName);
}

function isIngestExecutionActive(execution) {
  if (!execution || execution.completionTime) return false;
  const conditions = execution.conditions || [];
  for (const c of conditions) {
    if (
      c.type === "Completed" &&
      (c.state === "CONDITION_SUCCEEDED" || c.state === "CONDITION_FAILED")
    ) {
      return false;
    }
    if (c.type === "Cancelled" && c.state === "CONDITION_SUCCEEDED") {
      return false;
    }
  }
  return true;
}

/**
 * ingest-worker-job 실행 중(미완료) execution 수 (최신 페이지만, 근사치)
 * @param {string} projectId
 * @returns {Promise<number|null>}
 */
async function getActiveIngestJobExecutionCount(projectId) {
  const jobRegion = AppConfig.JOB_REGION;
  const jobName = AppConfig.JOB_NAME;
  if (!projectId || !jobRegion || !jobName) return null;

  const parent = `projects/${projectId}/locations/${jobRegion}/jobs/${jobName}`;
  const url = `https://${jobRegion}-run.googleapis.com/v2/${parent}/executions?pageSize=100`;

  try {
    const accessToken = await getAccessToken();
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      await response.text();
      return null;
    }
    const data = await response.json();
    const executions = data?.executions || [];
    let active = 0;
    for (const ex of executions) {
      if (isIngestExecutionActive(ex)) active += 1;
    }
    return active;
  } catch (err) {
    logOperationalWarn("[cloudTasks] getActiveIngestJobExecutionCount failed", {
      tenant_id: "system",
      function_name: "getActiveIngestJobExecutionCount",
      extra: { error: err?.message || String(err), jobName, jobRegion }
    });
    return null;
  }
}

/**
 * Worker 파이프라인 부하 추정: 큐 대기 task + 실행 중 Job execution
 * @param {string} projectId
 * @returns {Promise<number|null>}
 */
async function getWorkerPipelineCount(projectId) {
  // 직접 실행 함수는 동작 중인 인스턴스도 Cloud Tasks dispatch에 포함되므로 queue stats만 사용합니다.
  // 롤백용 legacy Job 경로에서만 별도 Cloud Run Job execution 수를 합산합니다.
  if (environment.INGEST_FUNCTION_URL) {
    return getWorkerQueueTaskCount(projectId);
  }
  const [queued, running] = await Promise.all([
    getWorkerQueueTaskCount(projectId),
    getActiveIngestJobExecutionCount(projectId)
  ]);
  if (queued === null && running === null) return null;
  return (queued ?? 0) + (running ?? 0);
}

/**
 * Enqueue ARS mapping worker via Cloud Tasks (same queue as ingest when possible).
 */
async function enqueueArsMappingTask({
  tenant,
  dataset,
  force_full = false,
  changed_row_ids = null,
  job_id
}) {
  const location = environment.GCP_LOCATION;
  const queueName = environment.CLOUD_TASKS_QUEUE_NAME;
  const jobUrl = environment.ARS_MAPPING_FUNCTION_URL;
  const serviceAccountEmail = environment.CLOUD_TASKS_SERVICE_ACCOUNT;
  const projectId = environment.GCP_PROJECT_ID || AppConfig.GCP_PROJECT_ID;

  if (!location || !queueName || !jobUrl || !serviceAccountEmail) {
    const err = new Error(
      `ARS mapping enqueue requires GCP_LOCATION, CLOUD_TASKS_QUEUE_NAME, ARS_MAPPING_FUNCTION_URL, CLOUD_TASKS_SERVICE_ACCOUNT`
    );
    err.code = "ARS_ENQUEUE_MISCONFIGURED";
    throw err;
  }

  const taskId =
    job_id ||
    `ars-${tenant.slice(0, 8)}-${dataset.slice(0, 8)}-${Date.now()}`;

  const payload = {
    tenant,
    dataset,
    force_full: !!force_full,
    job_id: taskId
  };
  // AJV array schema rejects null — omit when not an array (full remap).
  if (Array.isArray(changed_row_ids)) {
    payload.changed_row_ids = changed_row_ids;
  }

  return enqueueTask({
    projectId,
    location,
    queueName,
    jobUrl,
    serviceAccountEmail,
    taskName: taskId,
    dispatchDeadline: "1800s",
    tenantId: tenant,
    payload
  });
}

module.exports = {
  enqueueTask,
  enqueueWorkerTask,
  enqueueArsMappingTask,
  getQueueTaskCount,
  getWorkerQueueTaskCount,
  getActiveIngestJobExecutionCount,
  getWorkerPipelineCount,
  getAccessToken
};