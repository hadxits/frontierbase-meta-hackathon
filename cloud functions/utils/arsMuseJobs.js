const { randomUUID } = require("crypto");
const { store, storage } = require("@/firebase");
const environment = require("@/env");
const { AppConfig } = require("@/const/AppConfig");
const ApiError = require("@/errors/apiError");
const { isArsProcessingStatus } = require("@/const/ArsMenuStatus");
const { loadAndValidateTenant } = require("@/utils/tenant");
const { loadTenantMember } = require("@/utils/tenantMembership");
const { menuRef, datasetRef } = require("@/utils/arsMappingCore");
const {
  getLastFullJsonlPath,
  parseGsPath,
  saveArsJson,
  loadDraftTree,
  loadArsJson
} = require("@/utils/arsGcs");
const { parseJsonlToRows, hasJsonlParseIssues } = require("@/utils/jsonl");
const { enqueueTask } = require("@/utils/cloudTasks");
const { createMuseCaller } = require("@/utils/arsMuseLlm");
const { generateMuseTree } = require("@/utils/arsMuseGenerator");

const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const id = { type: "string", minLength: 1, maxLength: 128, pattern: "^[^/\\s]+$" };
const consoleParams = {
  type: "object",
  properties: { tenant: id, dataset_id: id, locale: { type: "string" } },
  required: ["tenant", "dataset_id"],
  additionalProperties: false
};

function error(code, message, status = 400) {
  return new ApiError({ errorCode: code, message, httpStatusCode: status, returnToUser: true });
}

async function assertAccess(req) {
  const { tenant, locale = "en" } = req.body;
  await loadAndValidateTenant(tenant, { locale, requireQdrantUrl: false });
  const member = await loadTenantMember(tenant, req.auth.uid);
  if (!member.isActive) throw error("FORBIDDEN", "Active tenant membership required", 403);
}

// Prevent late progress or failure records from previous tasks from overwriting new tasks.
// Mirror only status changes to the dataset; keep progress on the menu to avoid extra history entries.
async function updateJob(tenant, dataset, jobId, patch) {
  return store.runTransaction(async (tx) => {
    const ref = menuRef(tenant, dataset);
    const ds = datasetRef(tenant, dataset);
    const [snap, dsSnap] = await Promise.all([tx.get(ref), tx.get(ds)]);
    const current = snap.data();
    if (!dsSnap.exists || current?.job_id !== jobId || !isArsProcessingStatus(current.status))
      return false;
    if (
      patch.status !== "failed" &&
      (dsSnap.data().status !== "ready" ||
        getLastFullJsonlPath(dsSnap.data()) !== current.source_jsonl_path ||
        Date.now() - current.mapping_started_at >= JOB_TIMEOUT_MS)
    ) {
      throw new Error("Dataset changed during generation; generate again using the current source");
    }
    const now = Date.now();
    tx.set(ref, { ...patch, updated_at: now }, { merge: true });
    if (patch.status && patch.status !== current.status) {
      tx.set(
        ds,
        { ars: { ...patch, menu_id: dataset, updated_at: now }, updated_at: now },
        { merge: true }
      );
    }
    return true;
  });
}

// A killed worker may never save a failure. Expire stale jobs so generation can be retried.
async function expireJob(tenant, dataset, data) {
  if (
    data?.engine === "muse" &&
    isArsProcessingStatus(data.status) &&
    Date.now() - data.mapping_started_at >= JOB_TIMEOUT_MS
  ) {
    await updateJob(tenant, dataset, data.job_id, {
      status: "failed",
      stage: "failed",
      error: "ARS generation timed out"
    });
  }
}

// Claim the same ARS document as the legacy generator so they cannot build drafts concurrently.
async function startMuseJob(tenant, dataset) {
  const queueUrl = environment.ARS_MUSE_MAPPING_FUNCTION_URL;
  if (
    !environment.MODEL_API_KEY ||
    !queueUrl ||
    !environment.CLOUD_TASKS_QUEUE_NAME ||
    !environment.CLOUD_TASKS_SERVICE_ACCOUNT
  ) {
    throw error(
      "MUSE_NOT_CONFIGURED",
      "Configure MODEL_API_KEY, ARS_MUSE_MAPPING_FUNCTION_URL and Cloud Tasks",
      503
    );
  }
  if (!queueUrl.startsWith("https://"))
    throw error("MUSE_NOT_CONFIGURED", "Worker URL must use HTTPS", 503);
  const ref = menuRef(tenant, dataset);
  await expireJob(tenant, dataset, (await ref.get()).data());
  const jobId = randomUUID();
  const now = Date.now();
  await store.runTransaction(async (tx) => {
    const ds = datasetRef(tenant, dataset);
    const [menu, source] = await Promise.all([tx.get(ref), tx.get(ds)]);
    if (!source.exists) throw error("NOT_FOUND", "Dataset not found", 404);
    const data = source.data();
    if (data.status !== "ready") throw error("DATASET_NOT_READY", "Dataset must be ready");
    if (isArsProcessingStatus(menu.data()?.status) || isArsProcessingStatus(data.ars?.status)) {
      throw error("ARS_ALREADY_PROCESSING", "ARS generation is already running", 409);
    }
    const path = getLastFullJsonlPath(data);
    if (!path) throw error("NO_JSONL", "Dataset has no JSONL snapshot");
    const state = {
      job_id: jobId,
      engine: "muse",
      model: environment.MUSE_ARS_MODEL,
      status: "processing",
      stage: "queued",
      progress: 0,
      source_dataset_id: dataset,
      source_jsonl_path: path,
      mapping_started_at: now,
      worker_started_at: null,
      tree_gcs_path: null,
      row_labels_gcs_path: null,
      report_gcs_path: null,
      grouping_meta: null,
      usage: null,
      error: null,
      updated_at: now
    };
    tx.set(ref, state, { merge: true });
    tx.set(ds, { ars: { ...state, menu_id: dataset }, updated_at: now }, { merge: true });
  });
  try {
    await enqueueTask({
      projectId: AppConfig.GCP_PROJECT_ID,
      location: environment.GCP_LOCATION,
      queueName: environment.CLOUD_TASKS_QUEUE_NAME,
      jobUrl: queueUrl,
      serviceAccountEmail: environment.CLOUD_TASKS_SERVICE_ACCOUNT,
      taskName: `ars-muse-${jobId}`,
      dispatchDeadline: "1800s",
      tenantId: tenant,
      payload: { tenant, dataset_id: dataset, job_id: jobId }
    });
  } catch {
    await updateJob(tenant, dataset, jobId, {
      status: "failed",
      stage: "failed",
      error: "Could not enqueue ARS generation"
    });
    throw error("ARS_ENQUEUE_FAILED", "Could not enqueue ARS generation", 503);
  }
  return {
    success: true,
    dataset_id: dataset,
    job_id: jobId,
    status: "processing",
    stage: "queued",
    progress: 0
  };
}

// Claim the job before calling the model; Cloud Tasks may deliver it more than once.
async function runMuseJob(tenant, dataset, jobId) {
  const ref = menuRef(tenant, dataset);
  await expireJob(tenant, dataset, (await ref.get()).data());
  const job = await store.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (data?.job_id !== jobId || data.engine !== "muse" || data.status !== "processing")
      return null;
    if (data.worker_started_at)
      throw error("ARS_ALREADY_PROCESSING", "Worker is already running", 409);
    tx.set(ref, { worker_started_at: Date.now() }, { merge: true });
    return data;
  });
  if (!job) return { success: true, skipped: true };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("ARS generation timed out")),
    Math.max(1, JOB_TIMEOUT_MS - (Date.now() - job.mapping_started_at) - 15_000)
  );
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, calls: 0 };
  try {
    const { bucket, name } = parseGsPath(job.source_jsonl_path);
    const file = storage.bucket(bucket).file(name);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) > 2 * 1024 * 1024)
      throw new Error("ARS source exceeds the 2 MiB generation limit");
    const [buffer] = await storage
      .bucket(bucket)
      .file(name, { generation: metadata.generation })
      .download();
    const parsed = parseJsonlToRows(buffer.toString("utf8"));
    if (hasJsonlParseIssues(parsed.issues))
      throw new Error("Invalid JSONL source; fix malformed or incomplete rows");
    const ask = createMuseCaller({
      apiKey: environment.MODEL_API_KEY,
      model: job.model,
      signal: controller.signal,
      onUsage: async (u) => {
        usage.input_tokens += Number(u.prompt_tokens || 0);
        usage.output_tokens += Number(u.completion_tokens || 0);
        usage.total_tokens += Number(u.total_tokens || 0);
        usage.calls += 1;
      }
    });
    const result = await generateMuseTree(parsed.rows, {
      ask,
      onProgress: async (progress, stage) => {
        if (controller.signal.aborted) throw controller.signal.reason;
        const saved = await updateJob(tenant, dataset, jobId, { progress, stage, usage });
        if (!saved) {
          controller.abort(new Error("ARS job was replaced or dataset was deleted"));
          throw controller.signal.reason;
        }
      }
    });
    // Job-specific filenames prevent a timed-out upload from replacing a newer draft.
    // They stay under the existing ars/{tenant}/{dataset} prefix and use its pointers.
    const save = (kind, data) =>
      saveArsJson({ tenantId: tenant, datasetId: dataset, jobId, kind, data });
    const [treePath, reportPath] = await Promise.all([
      save("draft_tree", result.tree),
      save("muse_report", result.report)
    ]);
    const saved = await updateJob(tenant, dataset, jobId, {
      status: "draft",
      stage: "done",
      progress: 100,
      usage,
      source_mapped_at: Date.now(),
      last_mapped_at: Date.now(),
      last_mapped_jsonl_path: job.source_jsonl_path,
      tree_gcs_path: treePath,
      report_gcs_path: reportPath,
      grouping_meta: result.grouping_meta,
      error: null
    });
    return { success: true, skipped: !saved, ...result.grouping_meta };
  } catch (err) {
    await updateJob(tenant, dataset, jobId, {
      status: "failed",
      stage: "failed",
      usage,
      error: String(err.message || err).slice(0, 600)
    });
    // Terminal failures are visible to the console. Do not re-bill the entire job on a queue retry.
    return { success: false, job_id: jobId, error: String(err.message || err).slice(0, 600) };
  } finally {
    clearTimeout(timer);
  }
}

async function getMuseTree(tenant, dataset) {
  const ref = menuRef(tenant, dataset);
  let snap = await ref.get();
  if (!snap.exists) throw error("NOT_FOUND", "ARS menu not found", 404);
  await expireJob(tenant, dataset, snap.data());
  snap = await ref.get();
  if (!snap.exists) throw error("NOT_FOUND", "ARS menu not found", 404);
  const data = snap.data();
  return {
    success: true,
    dataset_id: dataset,
    job_id: data.job_id || null,
    engine: data.engine || "legacy",
    model: data.model || null,
    status: data.status,
    stage: data.engine === "muse" ? data.stage : null,
    progress: data.progress || 0,
    tree: data.status === "draft" || data.status === "published" ? await loadDraftTree(data) : null,
    tree_gcs_path: data.tree_gcs_path || null,
    row_labels_gcs_path: data.row_labels_gcs_path || null,
    mapping_report: data.report_gcs_path ? await loadArsJson(data.report_gcs_path) : null,
    grouping_meta: data.grouping_meta || null,
    report_gcs_path: data.report_gcs_path || null,
    source_jsonl_path: data.source_jsonl_path || null,
    usage: data.usage || null,
    error: data.error || null
  };
}

module.exports = { consoleParams, assertAccess, startMuseJob, runMuseJob, getMuseTree, updateJob };
