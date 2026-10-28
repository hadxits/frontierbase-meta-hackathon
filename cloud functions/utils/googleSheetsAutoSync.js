const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const SourceType = require("@/const/SourceType");
const chunkArray = require("@/utils/chunkArray");
const { logInfo } = require("@/utils/logger");

const FIRESTORE_BATCH_LIMIT = 500;
const MIN_SYNC_INTERVAL_SEC = 60;
const MAX_SYNC_INTERVAL_SEC = 12 * 60 * 60;
const ERROR_BACKOFF_MS = 5 * 60 * 1000;
const SYNC_CLAIM_MIN_HOLD_MS = 3 * 60 * 1000;

/**
 * @param {Record<string, unknown> | null | undefined} datasetData
 * @returns {number | null} sync_interval (seconds), valid range 60~43200
 */
function parseSyncIntervalSeconds(datasetData) {
  const raw = datasetData?.sync_interval;
  if (raw === undefined || raw == null || String(raw).trim() === "") return null;
  const seconds = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(seconds)) return null;
  if (seconds < MIN_SYNC_INTERVAL_SEC || seconds > MAX_SYNC_INTERVAL_SEC) return null;
  return seconds;
}

async function deferNextSyncAt(datasetRef, nowMs, delayMs) {
  await datasetRef.set({ next_sync_at: nowMs + delayMs }, { merge: true });
}

/** On sync completion + sync_interval → next_sync_at, last_sync_at */
async function writeNextSyncAtFromInterval(datasetRef, datasetData, nowMs = Date.now()) {
  const intervalSec = parseSyncIntervalSeconds(datasetData);
  if (!intervalSec) return false;
  await datasetRef.set(
    {
      next_sync_at: nowMs + intervalSec * 1000,
      last_sync_at: nowMs
    },
    { merge: true }
  );
  return true;
}

/** On sync failure, reschedule next_sync_at with backoff */
async function rescheduleNextSyncAfterFailure(datasetRef, datasetData, nowMs = Date.now()) {
  const intervalSec = parseSyncIntervalSeconds(datasetData);
  if (!intervalSec) return false;
  const delayMs = Math.min(intervalSec * 1000, ERROR_BACKOFF_MS);
  await datasetRef.set({ next_sync_at: nowMs + delayMs }, { merge: true });
  return true;
}

/** Reserve next_sync_at to prevent re-query during sync */
async function claimDatasetForSync(datasetRef, datasetData, nowMs = Date.now()) {
  const intervalSec = parseSyncIntervalSeconds(datasetData);
  if (!intervalSec) return false;
  const holdMs = Math.max(intervalSec * 1000, SYNC_CLAIM_MIN_HOLD_MS);
  await datasetRef.set(
    {
      next_sync_at: nowMs + holdMs,
      sync_claimed_at: nowMs
    },
    { merge: true }
  );
  return true;
}

/**
 * Set auto_sync_enabled to false for tenant's Google Sheets datasets.
 * @param {string} tenantId
 * @returns {Promise<{ updated: number }>}
 */
async function disableGoogleSheetsAutoSyncForTenant(tenantId) {
  const tenant = String(tenantId || "").trim();
  if (!tenant) return { updated: 0 };

  const snap = await store
    .collection(Collection.TENANTS)
    .doc(tenant)
    .collection(Collection.DATASETS)
    .where("source_type", "==", SourceType.GOOGLE_SHEETS)
    .get();

  if (snap.empty) return { updated: 0 };

  const now = Date.now();
  const refsToDisable = snap.docs
    .filter((doc) => doc.data()?.auto_sync_enabled !== false)
    .map((doc) => doc.ref);

  if (refsToDisable.length === 0) return { updated: 0 };

  for (const refs of chunkArray(refsToDisable, FIRESTORE_BATCH_LIMIT)) {
    const batch = store.batch();
    for (const ref of refs) {
      batch.set(ref, { auto_sync_enabled: false, updated_at: now }, { merge: true });
    }
    await batch.commit();
  }

  logInfo("[disableGoogleSheetsAutoSyncForTenant] Disabled Google Sheets auto sync", {
    tenant_id: tenant,
    function_name: "disableGoogleSheetsAutoSyncForTenant",
    extra: { updated: refsToDisable.length }
  });

  return { updated: refsToDisable.length };
}

module.exports = {
  MIN_SYNC_INTERVAL_SEC,
  MAX_SYNC_INTERVAL_SEC,
  parseSyncIntervalSeconds,
  deferNextSyncAt,
  writeNextSyncAtFromInterval,
  rescheduleNextSyncAfterFailure,
  claimDatasetForSync,
  disableGoogleSheetsAutoSyncForTenant
};