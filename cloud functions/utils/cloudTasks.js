/**
 * ============================================================================
 * cloudTasks.js - Common utilities for Cloud Tasks.
 * ============================================================================
 *
 * Provides a common function to enqueue tasks into Cloud Tasks Queue.
 *
 * ⚠️ Concurrent execution (GCP queue settings):
 * - max-concurrent-dispatches=AppConfig.WORKER_MAX_CONCURRENT_DISPATCHES (currently 5)
 *   → In the new path, limit ingestWorker execution; in the legacy path, limit Job execution.
 * - Prevent concurrent indexing of the same dataset using ingestCore's processing_job_id.
 * ============================================================================
 */
const { GoogleAuth } = require("google-auth-library");
const crypto = require("crypto");
const environment = require("@/env");
const { AppConfig } = require("@/const/AppConfig");
const { logInfo, logAndCaptureError, logOperationalWarn } = require("@/utils/logger");

// ============================================================================
// Cloud Tasks API configuration.
// ============================================================================
const CLOUD_TASKS_API_BASE = "https://cloudtasks.googleapis.com/v2";
const CLOUD_TASKS_API_BASE_V2BETA3 = "https://cloudtasks.googleapis.com/v2beta3";

/**
 * Issue Google Cloud authentication token
 * @returns {Promise<string>} Access token
 */
async function getAccessToken() {
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
 * Add a task to the Cloud Tasks queue.
 *
 * @param {Object} params
 * @param {string} params.projectId - GCP project ID.
 * @param {string} params.location - GCP region (e.g., us-central1).
 * @param {string} params.queueName - Cloud Tasks queue name.
 * @param {string} params.jobUrl - Cloud Function worker.js URL
 * @param {Object} params.payload - Payload to send to the Cloud Function.
 * @param {string} params.serviceAccountEmail - Service account email for OIDC token generation (required).
 * @param {string} params.taskName - Task name (to prevent duplicates).
 * @param {string} [params.dispatchDeadline] - HTTP dispatch deadline (e.g., "1250s").
 * @param {string} [params.tenantId] - Tenant ID (for logging).
 * @returns {Promise<Object>} Created task information.
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

  // OIDC token is required.
  if (!serviceAccountEmail) {
    throw new Error(
      "CLOUD_TASKS_SERVICE_ACCOUNT 환경변수가 필요합니다. OIDC 토큰을 사용해야 합니다."
    );
  }

  httpRequest.oidcToken = {
    serviceAccountEmail,
    // This module does not verify the token. Cloud Run IAM verifies the audience.
    // Request Cloud Tasks to issue an OIDC token matching the target URL audience.
    audience: jobUrl
  };

  // Specify task name (to prevent duplicates).
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

  // Retrieve access token.
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
      // Ignore if errorText is not JSON.
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

    // Add queue creation guide for 404 errors.
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

    // Include key info in the message (to compare requested path and console queue location on 404).
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
 * Enqueue worker task to Cloud Tasks.
 *
 * @param {Object} params
 * @param {string} params.tenant - Tenant ID.
 * @param {string} params.dataset - Dataset ID.
 * @param {string} params.gcs_path - GCS file path for actual work (only toAdd + toUpdate).
 * @param {string} [params.full_gcs_path] - Full GCS file path for deletion detection (all newRows, optional).
 * @param {string} params.qdrant_url - Qdrant URL
 * @param {string} params.embed_model - Embedding model.
 * @param {number} params.vector_size - Vector dimension (critical value, e.g., 1536, 3072).
 * @param {string} params.project_id - GCP project ID.
 * @param {string} [params.dataset_locale] - Tenant language (ko, en, etc.) for worker's dataset.error multilingual support.
 * @param {string} [params.job_id] - Job ID created by the caller in advance.
 * @param {string} [params.taskName] - Cloud Tasks task ID created by the caller in advance.
 * @returns {Promise<Object>} Enqueue result.
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

  // Use the same ID for both Cloud Tasks name and ingest job_id once created.
  // Tenant/dataset original strings are not exposed in task resource names but shortened with fixed-length hashes.
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

  // Locale is used consistently in the function payload and legacy Job environment variables.
  const localeTag = String(dataset_locale ?? "en")
    .trim()
    .slice(0, 16)
    .replace(/[^a-zA-Z_-]/g, "") || "en";

  const envVars = [
    // JOB_ID is unique per upload unit (1 Task) and remains the same during Cloud Tasks delivery retries.
    // → Used in worker.js to prevent concurrent execution (lock) and determine retries.
    { name: "JOB_ID", value: resolvedJobId },
    { name: "TENANT", value: tenant },
    { name: "DATASET", value: datasetId },
    { name: "GCS_PATH", value: gcs_path }, // For actual work (only toAdd + toUpdate).
    { name: "QDRANT_URL", value: qdrant_url },
    { name: "EMBED_MODEL", value: embed_model },
    { name: "VECTOR_SIZE", value: String(vector_size) }, // Vector dimension (critical value).
    { name: "DATASET_LOCALE", value: localeTag }
  ];

  // If full_gcs_path exists, add it as an environment variable (for deletion tracking).
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
    // Cloud Tasks HTTP deadline must be longer than ingestWorker's 1200-second timeout and less than 30 minutes.
    dispatchDeadline: ingestFunctionUrl ? "1250s" : undefined,
    tenantId: tenant
  });
  return { ...taskResult, job_id: resolvedJobId };
}

/**
 * Retrieve estimated count of tasks waiting or processing in the queue.
 * - Reason for using v2beta3: official v2 Queue resource lacks stats field, and QueueStats(tasksCount) is only available in v2beta3.
 * @param {string} projectId - GCP project ID.
 * @param {string} location - Region (e.g., us-central1).
 * @param {string} queueName - Queue name.
 * @returns {Promise<number|null>} Estimated tasksCount, or null on failure.
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
      await response.text(); // Consume body and clean up connections/resources.
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
 * Retrieve count of waiting tasks in the Worker queue (based on environment variables).
 * @param {string} projectId - GCP project ID.
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
 * Count of running (unfinished) executions of ingest-worker-job (latest page only, approximate).
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
 * Estimate Worker pipeline load: queued tasks + running Job executions.
 * @param {string} projectId
 * @returns {Promise<number|null>}
 */
async function getWorkerPipelineCount(projectId) {
  // Direct execution functions include running instances in Cloud Tasks dispatch, so only queue stats are used.
  // For rollback legacy Job paths only, separately sum Cloud Run Job executions.
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