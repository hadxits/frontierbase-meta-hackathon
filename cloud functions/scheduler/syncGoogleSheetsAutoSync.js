/**
 * ============================================================================
 * syncGoogleSheetsAutoSync.js — Google Sheets auto-sync every 1 minute.
 * ============================================================================
 *
 * Query documents in collectionGroup(datasets) where next_sync_at <= now,
 * and call runSyncGoogleSheetsDataset if tenant.plan != FREE.
 *
 * Repeat querying in BATCH_LIMIT units until the due queue is empty in one run.
 * Claim next_sync_at before sync to reduce overlapping runs or duplicate crons.
 *
 * Firestore composite index (collection group datasets):
 *   source_type ASC, next_sync_at ASC
 * ============================================================================
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const SourceType = require("@/const/SourceType");
const DatasetStatus = require("@/const/DatasetStatus");
const { runSyncGoogleSheetsDataset } = require("@/endpoints/ai/syncGoogleSheetsDataset");
const ApiError = require("@/errors/apiError");
const { logInfo, logWarn, logAndCaptureError, isOperationalError } = require("@/utils/logger");
const { flushSentry } = require("@/utils/sentry");
const {
  parseSyncIntervalSeconds,
  deferNextSyncAt,
  rescheduleNextSyncAfterFailure,
  claimDatasetForSync
} = require("@/utils/googleSheetsAutoSync");

const BATCH_LIMIT = 15;
const SCHEDULER_TIMEOUT_MS = 540 * 1000;
const RUN_DEADLINE_BUFFER_MS = 30 * 1000;
const IN_PROGRESS_RETRY_MS = 60 * 1000;
const FREE_PLAN_DEFER_MS = 5 * 60 * 1000;

function resolveTenantId(datasetDoc, datasetData) {
  const fromData = String(datasetData?.tenant_id || "").trim();
  if (fromData) return fromData;
  const parent = datasetDoc.ref.parent.parent;
  return parent ? String(parent.id || "").trim() : "";
}

function resolveDatasetId(datasetDoc, datasetData) {
  const fromData = String(datasetData?.dataset_id || "").trim();
  return fromData || String(datasetDoc.id || "").trim();
}

async function isPaidTenant(tenantId, cache) {
  if (cache.has(tenantId)) return cache.get(tenantId);
  const snap = await store.collection(Collection.TENANTS).doc(tenantId).get();
  const plan = String(snap.data()?.plan || "FREE").toUpperCase();
  const paid = snap.exists && plan !== "FREE";
  cache.set(tenantId, paid);
  return paid;
}

async function fetchDueDatasets(nowMs) {
  return store
    .collectionGroup(Collection.DATASETS)
    .where("status", "==", 'ready')
    .where("source_type", "==", SourceType.GOOGLE_SHEETS)
    .where("auto_sync_enabled", "==", true)
    .where("next_sync_at", "<=", nowMs)
    .orderBy("next_sync_at")
    .limit(BATCH_LIMIT)
    .get();
}

/**
 * @returns {"synced" | "skipped" | "failed"}
 */
async function processDueDataset(datasetDoc, tenantPlanCache) {
  const datasetData = datasetDoc.data() || {};
  const tenantId = resolveTenantId(datasetDoc, datasetData);
  const datasetId = resolveDatasetId(datasetDoc, datasetData);

  if (!tenantId || !datasetId) {
    logWarn("[syncGoogleSheetsAutoSync] Missing tenant/dataset id", {
      tenant_id: tenantId || "unknown",
      function_name: "syncGoogleSheetsAutoSync",
      extra: { dataset_path: datasetDoc.ref.path }
    });
    return "skipped";
  }

  if (datasetData?.next_sync_at == null) {
    return "skipped";
  }

  const intervalSec = parseSyncIntervalSeconds(datasetData);

  if (!intervalSec) {
    logWarn("[syncGoogleSheetsAutoSync] Missing or invalid sync_interval", {
      tenant_id: tenantId,
      function_name: "syncGoogleSheetsAutoSync",
      extra: { dataset_id: datasetId }
    });
    return "skipped";
  }

  if (!(await isPaidTenant(tenantId, tenantPlanCache))) {
    logInfo("[syncGoogleSheetsAutoSync] Skip FREE plan tenant", {
      tenant_id: tenantId,
      function_name: "syncGoogleSheetsAutoSync",
      extra: { dataset_id: datasetId }
    });
    return "skipped";
  }

  const claimMs = Date.now();
  try {
    await claimDatasetForSync(datasetDoc.ref, datasetData, claimMs);
  } catch (claimErr) {
    logWarn("[syncGoogleSheetsAutoSync] Failed to claim dataset", {
      tenant_id: tenantId,
      function_name: "syncGoogleSheetsAutoSync",
      extra: {
        dataset_id: datasetId,
        error: claimErr?.message || String(claimErr)
      }
    });
    return "failed";
  }

  try {
    const result = await runSyncGoogleSheetsDataset({
      tenantId,
      datasetId,
      locale: "en"
    });
    logInfo("[syncGoogleSheetsAutoSync] Sync finished", {
      tenant_id: tenantId,
      function_name: "syncGoogleSheetsAutoSync",
      extra: {
        dataset_id: datasetId,
        no_change: !!result?.noChange,
        synced: result?.synced !== false
      }
    });
    return "synced";
  } catch (err) {
    const errorCode = err instanceof ApiError ? err.errorCode : err?.name || "SYNC_FAILED";
    logWarn("[syncGoogleSheetsAutoSync] Sync failed", {
      tenant_id: tenantId,
      function_name: "syncGoogleSheetsAutoSync",
      extra: {
        dataset_id: datasetId,
        error_code: errorCode,
        message: err?.message || String(err)
      }
    });
    // Send to Sentry if error is not an expected user/business error.
    if (!isOperationalError(err)) {
      logAndCaptureError(
        err instanceof Error ? err : new Error(String(err)),
        "[syncGoogleSheetsAutoSync] Sync failed",
        {
          tenant_id: tenantId,
          function_name: "syncGoogleSheetsAutoSync",
          extra: {
            dataset_id: datasetId,
            error_code: errorCode
          }
        }
      );
    }
    try {
      await rescheduleNextSyncAfterFailure(datasetDoc.ref, datasetData, Date.now());
    } catch (scheduleErr) {
      logWarn("[syncGoogleSheetsAutoSync] Failed to reschedule next_sync_at", {
        tenant_id: tenantId,
        function_name: "syncGoogleSheetsAutoSync",
        extra: {
          dataset_id: datasetId,
          error: scheduleErr?.message || String(scheduleErr)
        }
      });
      logAndCaptureError(
        scheduleErr instanceof Error
          ? scheduleErr
          : new Error(String(scheduleErr)),
        "[syncGoogleSheetsAutoSync] Failed to reschedule next_sync_at",
        {
          tenant_id: tenantId,
          function_name: "syncGoogleSheetsAutoSync",
          extra: { dataset_id: datasetId }
        }
      );
    }
    return "failed";
  }
}

async function runSyncGoogleSheetsAutoSync() {
  const runDeadlineMs = Date.now() + SCHEDULER_TIMEOUT_MS - RUN_DEADLINE_BUFFER_MS;
  const tenantPlanCache = new Map();
  let processed = 0;
  let synced = 0;
  let skipped = 0;
  let failed = 0;
  let batches = 0;

  while (Date.now() < runDeadlineMs) {
    const snap = await fetchDueDatasets(Date.now());
    if (snap.empty) break;

    batches += 1;
    for (const datasetDoc of snap.docs) {
      if (Date.now() >= runDeadlineMs) break;

      const outcome = await processDueDataset(datasetDoc, tenantPlanCache);
      processed += 1;
      if (outcome === "synced") synced += 1;
      else if (outcome === "failed") failed += 1;
      else skipped += 1;
    }
  }

  if (processed === 0) {
    logInfo("[syncGoogleSheetsAutoSync] No due datasets", {
      tenant_id: "system",
      function_name: "syncGoogleSheetsAutoSync",
      extra: { now_ms: Date.now() }
    });
    return { processed: 0, synced: 0, skipped: 0, failed: 0, batches: 0 };
  }

  logInfo("[syncGoogleSheetsAutoSync] Run completed", {
    tenant_id: "system",
    function_name: "syncGoogleSheetsAutoSync",
    extra: { processed, synced, skipped, failed, batches }
  });

  return { processed, synced, skipped, failed, batches };
}

const syncGoogleSheetsAutoSync = onSchedule(
  {
    schedule: "*/1 * * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    timeoutSeconds: 540,
    cpu: "gcf_gen1"
  },
  async () => {
    try {
      await runSyncGoogleSheetsAutoSync();
    } catch (err) {
      logAndCaptureError(
        err instanceof Error ? err : new Error(String(err)),
        "[syncGoogleSheetsAutoSync] Scheduled run failed",
        {
          tenant_id: "system",
          function_name: "syncGoogleSheetsAutoSync"
        }
      );
      throw err;
    } finally {
      await flushSentry();
    }
  }
);

module.exports = syncGoogleSheetsAutoSync;
module.exports.runSyncGoogleSheetsAutoSync = runSyncGoogleSheetsAutoSync;