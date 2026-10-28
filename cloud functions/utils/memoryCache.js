/**
 * ============================================================================
 * memoryCache.js - Memory cache management utility
 * ============================================================================
 *
 * Manages memory cache that persists during Firebase Functions instance lifecycle.
 * For multi-tenant isolation, all keys use the format `${tenant_id}:${resource_id}`.
 *
 * Cache types:
 * 1. conversationCache: Cache for Chat and Messages
 * 2. datasetCache: Cache for Dataset documents
 * 3. promptCache: Cache for Prompt documents
 * 4. tenantCache: Cache for Tenant documents (pre-cached in init mode)
 *
 * TTL: 10 minutes (CACHE_TTL_MS)
 * - conversationCache / tenantCache: expire based on TTL
 * - datasetCache / promptCache: always validate against tenant meta (updated_at/version) if possible (overrides TTL)
 *   Use TTL only if tenant meta is missing (to prevent infinite staleness)
 * - Global and combined prompts cache for 1 day (PROMPT_CACHE_TTL_MS)
 * ============================================================================
 */

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes (conversation, dataset, prompt, tenant)
const PROMPT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day (global prompts, combined prompts)

// ============================================================================
// Init mode cache cleanup (removing leftovers) settings
// - Cleanup with limited budget only during init requests (to easily control response delay/cost limits)
// - Expose as const for easy adjustment during operation
// ============================================================================
const INIT_CACHE_CLEANUP_BUDGET = 10; // Maximum number of tenants to clean up per init call
const INIT_CACHE_CLEANUP_STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // Tenants older than this time are considered stale (default 7 days)
const INIT_CACHE_CLEANUP_SCAN_LIMIT = 5000; // Maximum scan count in tenantCache (to prevent sorting/full scan)
const INIT_CACHE_CLEANUP_CANDIDATE_CAP_MULTIPLIER = 5; // Collect candidates up to budget * n, then sort
const INIT_CACHE_CLEANUP_MIN_INTERVAL_MS = 60 * 1000; // Minimum execution interval per instance (to avoid running too frequently)
let lastInitCleanupAt = 0;

// ============================================================================
// Timestamp normalization function
// Convert Firestore Timestamp object or number (milliseconds) to a consistent number
// ============================================================================
function normalizeTimestamp(ts) {
  if (ts === null || ts === undefined) return null;
  if (typeof ts === 'number') return ts;
  if (ts.toMillis) return ts.toMillis(); // Firestore Timestamp
  if (ts._seconds) return ts._seconds * 1000; // Firestore Timestamp (raw)
  if (ts instanceof Date) return ts.getTime();
  return null;
}

// ============================================================================
// Memory cache Map instance
// ============================================================================
const conversationCache = new Map();
const datasetCache = new Map();
const promptCache = new Map();
const tenantCache = new Map();

// ============================================================================
// Cache key generation function
// ============================================================================
function getCacheKey(tenantId, conversationId) {
  return `${tenantId}:${conversationId}`;
}

function getDatasetCacheKey(tenantId, datasetId) {
  return `${tenantId}:${datasetId}`;
}

function getPromptCacheKey(tenantId, promptId) {
  return `${tenantId}:${promptId}`;
}

function getTenantCacheKey(tenantId) {
  return tenantId;
}

// ============================================================================
// Conversation cache function
// ============================================================================
function getCachedConversation(tenantId, conversationId) {
  const key = getCacheKey(tenantId, conversationId);
  const cached = conversationCache.get(key);
  if (!cached) return null;

  // TTL check (10 minutes)
  const cacheAge = Date.now() - cached.lastUpdated;
  if (cacheAge > CACHE_TTL_MS) {
    // Expired: return null to force caller to reread Firestore without deleting
    return null;
  }

  return cached;
}

function setCachedConversation(tenantId, conversationId, chat, messages) {
  const key = getCacheKey(tenantId, conversationId);
  conversationCache.set(key, {
    chat,
    messages,
    lastUpdated: Date.now()
  });
}

// ============================================================================
// Dataset cache function
// ============================================================================
/**
 * Purpose of Dataset cache:
 *
 * 1. Dataset filtering (Dataset Similarity Filtering)
 *    - When targetDatasets has 3 or more, compare each dataset's embed_value with question embedding
 *    - Calculate cosine similarity to select only relevant datasets
 *    - Optimize RAG search performance (avoid unnecessary dataset queries)
 *
 * 2. Cost reduction
 *    - Dataset documents rarely change, so use memory cache to avoid repeated Firestore reads
 *    - Reduce Firestore read costs and improve response speed
 *
 * 3. Change detection
 *    - Compare tenant object's datasets_metadata[datasetId].updated_at in memory
 *    - Invalidate cache if timestamps differ to ensure fresh data
 *
 * Cache operation flow:
 * 1. Call filterDatasetsBySimilarity()
 * 2. Check memory cache with getCachedDatasets()
 * 3. If in cache → use immediately (skip Firestore read)
 * 4. If not in cache → read from Firestore and save to cache
 * 5. Compare each dataset's embed_value with question embedding
 * 6. Select datasets with high similarity
 *
 * TTL: 10 minutes (CACHE_TTL_MS)
 * If TTL expired but tenant's datasets_metadata[datasetId].updated_at is unchanged, reuse cache (refresh TTL)
 */
function getCachedDataset(tenantId, datasetId, tenantData = null) {
  const key = getDatasetCacheKey(tenantId, datasetId);
  const cached = datasetCache.get(key);
  if (!cached) return null;

  // ✅ Change: Since dataset is "reference info", verify changes with tenant meta (updated_at) on each request if possible to keep cache.
  // - If tenant meta exists, compare regardless of TTL (10 minutes)
  // - If tenant meta missing, fallback to existing TTL protection
  if (tenantData?.datasets_metadata?.[datasetId]) {
    const tenantDatasetMeta = tenantData.datasets_metadata[datasetId];
    const cachedTimestamp = normalizeTimestamp(cached.updated_at);
    const tenantTimestamp = normalizeTimestamp(tenantDatasetMeta.updated_at);

    if (tenantTimestamp !== null && cachedTimestamp !== null && tenantTimestamp === cachedTimestamp) {
      // No change → reuse (update access time)
      cached.lastUpdated = Date.now();
      return cached;
    }
    // Changed (or cannot compare) → invalidate
    datasetCache.delete(key);
    return null;
  }

  const cacheAge = Date.now() - cached.lastUpdated;

  if (cacheAge > CACHE_TTL_MS) {
    // If tenant meta missing, return null after TTL to reload (do not delete)
    return null;
  }

  return cached;
}

function setCachedDataset(tenantId, datasetId, data, timestamp = null) {
  const key = getDatasetCacheKey(tenantId, datasetId);
  // If timestamp not provided, auto-extract from data (prefer updated_at, else created_at)
  // Normalize and store as number (milliseconds)
  const rawTimestamp = timestamp !== null
    ? timestamp
    : (data?.updated_at || data?.created_at || null);
  const finalTimestamp = normalizeTimestamp(rawTimestamp);

  datasetCache.set(key, {
    data,
    updated_at: finalTimestamp,
    lastUpdated: Date.now()
  });
}

/**
 * Retrieve multiple Dataset documents from cache (return null if not found)
 * Return value is compatible with Firestore DocumentSnapshot
 * @param {string} tenantId - Tenant ID
 * @param {string[]} datasetIds - Array of Dataset IDs
 * @param {object} tenantData - Tenant document data (including metadata)
 */
function getCachedDatasets(tenantId, datasetIds, tenantData = null) {
  const results = [];
  const missingIds = [];

  for (let i = 0; i < datasetIds.length; i++) {
    const datasetId = datasetIds[i];
    const cached = getCachedDataset(tenantId, datasetId, tenantData);
    if (cached) {
      // Returns in a form compatible with Firestore DocumentSnapshot
      results[i] = {
        exists: true,
        data: () => cached.data,
        id: datasetId
      };
    } else {
      results[i] = null;
      missingIds.push(datasetId);
    }
  }

  return { results, missingIds };
}

// ============================================================================
// Prompt cache function
// ============================================================================
function getPromptTimestamp(data) {
  // Normalize and return as a number (milliseconds)
  return normalizeTimestamp(data?.updated_at || data?.created_at || null);
}

function getCachedPrompt(tenantId, promptId, tenantData = null) {
  if (!promptId) return null;
  const key = getPromptCacheKey(tenantId, promptId);
  const cached = promptCache.get(key);
  if (!cached) return null;

  // ✅ Change: Since prompt is "reference info", verify changes with tenant meta (version/updated_at) on each request if possible to keep it updated.
  // - If tenant meta exists, compare regardless of TTL (10 minutes)
  // - If tenant meta missing, fallback to existing TTL protection
  if (tenantData?.prompt_metadata) {
    const tenantPromptMeta = tenantData.prompt_metadata;
    const cachedTimestamp = normalizeTimestamp(cached.updated_at);
    const tenantTimestamp = normalizeTimestamp(tenantPromptMeta.updated_at);
    const tenantVersion = tenantPromptMeta.version || 0;
    const cachedVersion = cached.data?.tenant_version || 0;

    // Check tenant_version first, if missing compare updated_at
    const sameByVersion = tenantVersion > 0 && tenantVersion === cachedVersion;
    const sameByTimestamp =
      tenantVersion === 0 &&
      tenantTimestamp !== null &&
      cachedTimestamp !== null &&
      tenantTimestamp === cachedTimestamp;

    if (sameByVersion || sameByTimestamp) {
      cached.cachedAt = Date.now(); // Update access timestamp
      return cached;
    }

    // Changed → invalidate
    promptCache.delete(key);
    return null;
  }

  const cacheAge = Date.now() - cached.cachedAt;

  if (cacheAge > CACHE_TTL_MS) {
    // If tenant meta missing, return null after TTL to reload (do not delete)
    return null;
  }

  return cached;
}

function setCachedPrompt(tenantId, promptId, data, timestamp = null) {
  if (!promptId) return;
  const key = getPromptCacheKey(tenantId, promptId);
  // If timestamp not provided, auto-extract from data (prefer updated_at, else created_at)
  // Use getPromptTimestamp as is since it already normalizes
  const finalTimestamp =
      timestamp !== null ? normalizeTimestamp(timestamp) : getPromptTimestamp(data);
  promptCache.set(key, {
    data,
    updated_at: finalTimestamp, // Normalized number (milliseconds)
    cachedAt: Date.now() // Cache save time (for logging)
  });
}

function deleteCachedPrompt(tenantId, promptId) {
  if (!promptId) return;
  const key = getPromptCacheKey(tenantId, promptId);
  promptCache.delete(key);
}

// ============================================================================
// Global prompt cache function
// ============================================================================
const globalPromptCache = new Map();
const GLOBAL_PROMPT_KEY = "_global:system_prompt";

function getCachedGlobalPrompt(currentUpdatedAt = null) {
  const cached = globalPromptCache.get(GLOBAL_PROMPT_KEY);
  if (!cached) return null;

  // Check TTL (1 day)
  const cacheAge = Date.now() - cached.cachedAt;
  if (cacheAge > PROMPT_CACHE_TTL_MS) {
    // If TTL expired, compare updated_at
    // Normalize timestamps (handle both Timestamp objects and numbers)
    const normalizedCurrent = normalizeTimestamp(currentUpdatedAt);
    const normalizedCached = normalizeTimestamp(cached.updated_at);
    if (normalizedCurrent !== null && normalizedCached !== null) {
      if (normalizedCached === normalizedCurrent) {
        // If updated_at matches, reuse cache (refresh TTL)
        cached.cachedAt = Date.now();
        return cached;
      } else {
        // If updated_at differs, invalidate cache
        globalPromptCache.delete(GLOBAL_PROMPT_KEY);
        return null;
      }
    } else {
      // Invalidate cache if updated_at info is missing
      globalPromptCache.delete(GLOBAL_PROMPT_KEY);
      return null;
    }
  }

  // Invalidate if updated_at differs even within TTL
  const normalizedCurrent = normalizeTimestamp(currentUpdatedAt);
  const normalizedCached = normalizeTimestamp(cached.updated_at);
  if (normalizedCurrent !== null && normalizedCached !== null) {
    if (normalizedCached !== normalizedCurrent) {
      globalPromptCache.delete(GLOBAL_PROMPT_KEY);
      return null;
    }
  }

  return cached;
}

function setCachedGlobalPrompt(text, version, updatedAt = null) {
  globalPromptCache.set(GLOBAL_PROMPT_KEY, {
    text,
    version,
    updated_at: normalizeTimestamp(updatedAt), // Store normalized number (milliseconds)
    cachedAt: Date.now()
  });
}

// ============================================================================
// Combined system prompt cache function
// ============================================================================
const combinedPromptCache = new Map();

function getCombinedPromptCacheKey(tenantId, globalVersion, tenantVersion) {
  return `${tenantId}:${globalVersion}:${tenantVersion}`;
}

function getCachedCombinedPrompt(tenantId, globalVersion, tenantVersion) {
  const key = getCombinedPromptCacheKey(tenantId, globalVersion, tenantVersion);
  const cached = combinedPromptCache.get(key);
  if (!cached) return null;

  // Check TTL (1 day)
  const cacheAge = Date.now() - cached.cachedAt;
  if (cacheAge > PROMPT_CACHE_TTL_MS) {
    combinedPromptCache.delete(key);
    return null;
  }

  return cached;
}

function setCachedCombinedPrompt(tenantId, globalVersion, tenantVersion, combinedPrompt) {
  const key = getCombinedPromptCacheKey(tenantId, globalVersion, tenantVersion);
  combinedPromptCache.set(key, {
    combinedPrompt,
    cachedAt: Date.now()
  });
}

// ============================================================================
// Tenant cache function
// ============================================================================
/**
 * Purpose of Tenant cache:
 *
 * 1. Init mode optimization
 *    - Pre-cache tenant info in init mode when client accesses screen
 *    - Remove Firestore reads on actual message requests afterwards
 *
 * 2. Performance improvement
 *    - Tenant documents rarely change, so use memory cache to avoid repeated Firestore reads
 *    - Reduce Firestore read costs and improve response time (10-50ms improvement)
 *
 * 3. Use cumulative nature of Usage field
 *    - Usage field is cumulative, so safe to cache with TTL (10 minutes)
 *    - Billing window resets about once a month
 *
 * Cache operation flow:
 * 1. Load and cache tenant in init mode (including billing window)
 * 2. Check cache with getCachedTenant() in normal mode
 * 3. If in cache → use immediately (skip Firestore read)
 * 4. If not in cache → read from Firestore and save to cache
 *
 * TTL: 10 minutes (CACHE_TTL_MS)
 */
function getCachedTenant(tenantId) {
  const key = getTenantCacheKey(tenantId);
  const cached = tenantCache.get(key);
  if (!cached) return null;

  // TTL check (10 minutes)
  const cacheAge = Date.now() - cached.lastUpdated;
  if (cacheAge > CACHE_TTL_MS) {
    // Expired: return null to force caller to reread Firestore without deleting
    return null;
  }

  return cached.data;
}

function setCachedTenant(tenantId, tenantData) {
  const key = getTenantCacheKey(tenantId);
  tenantCache.set(key, {
    data: tenantData,
    lastUpdated: Date.now()
  });
}

function deleteCachedTenant(tenantId) {
  const key = getTenantCacheKey(tenantId);
  tenantCache.delete(key);
}

// ============================================================================
// Init mode cache cleanup (clean 5 caches per tenant together)
// - Select stale tenants based on tenantCache.lastUpdated
// - Delete conversation/dataset/prompt/combined caches with prefix for selected tenants
// - Return metrics so caller can log "8/10" and reduction rate (%)
// ============================================================================
function cleanupStaleTenantsOnInit(nowMs = Date.now(), options = {}) {
  const budget = Number.isFinite(options.budget) ? options.budget : INIT_CACHE_CLEANUP_BUDGET;
  const staleWindowMs = Number.isFinite(options.staleWindowMs)
    ? options.staleWindowMs
    : INIT_CACHE_CLEANUP_STALE_WINDOW_MS;
  const scanLimit = Number.isFinite(options.scanLimit)
    ? options.scanLimit
    : INIT_CACHE_CLEANUP_SCAN_LIMIT;
  const minIntervalMs = Number.isFinite(options.minIntervalMs)
    ? options.minIntervalMs
    : INIT_CACHE_CLEANUP_MIN_INTERVAL_MS;

  if (budget <= 0) {
    return { skipped: true, reason: "budget<=0" };
  }
  if (minIntervalMs > 0 && nowMs - lastInitCleanupAt < minIntervalMs) {
    return {
      skipped: true,
      reason: "throttled",
      next_allowed_in_ms: minIntervalMs - (nowMs - lastInitCleanupAt),
    };
  }
  lastInitCleanupAt = nowMs;

  const before = {
    tenant: tenantCache.size,
    conversation: conversationCache.size,
    dataset: datasetCache.size,
    prompt: promptCache.size,
    combinedPrompt: combinedPromptCache.size,
  };
  const beforeTotal =
    before.tenant +
    before.conversation +
    before.dataset +
    before.prompt +
    before.combinedPrompt;

  const cap = Math.max(10, budget * INIT_CACHE_CLEANUP_CANDIDATE_CAP_MULTIPLIER);
  const candidates = [];
  let scannedTenantEntries = 0;

  for (const [tenantId, entry] of tenantCache.entries()) {
    scannedTenantEntries++;
    if (scannedTenantEntries > scanLimit) break;

    const lastUpdated = Number(entry?.lastUpdated || 0);
    if (!Number.isFinite(lastUpdated) || lastUpdated <= 0) continue;
    if (nowMs - lastUpdated < staleWindowMs) continue;

    candidates.push({ tenantId: String(tenantId), lastUpdated });
    if (candidates.length >= cap) break; // Cost cap
  }

  candidates.sort((a, b) => a.lastUpdated - b.lastUpdated);
  const selected = candidates.slice(0, budget);
  const staleTenantIds = new Set(selected.map((c) => c.tenantId));

  const deleted = {
    tenants: 0,
    conversation: 0,
    dataset: 0,
    prompt: 0,
    combinedPrompt: 0,
  };

  for (const tenantId of staleTenantIds) {
    if (tenantCache.delete(tenantId)) deleted.tenants++;
  }

  if (staleTenantIds.size > 0) {
    for (const key of conversationCache.keys()) {
      const tenantPrefix = String(key).split(":", 1)[0];
      if (staleTenantIds.has(tenantPrefix)) {
        conversationCache.delete(key);
        deleted.conversation++;
      }
    }
    for (const key of datasetCache.keys()) {
      const tenantPrefix = String(key).split(":", 1)[0];
      if (staleTenantIds.has(tenantPrefix)) {
        datasetCache.delete(key);
        deleted.dataset++;
      }
    }
    for (const key of promptCache.keys()) {
      const tenantPrefix = String(key).split(":", 1)[0];
      if (staleTenantIds.has(tenantPrefix)) {
        promptCache.delete(key);
        deleted.prompt++;
      }
    }
    for (const key of combinedPromptCache.keys()) {
      const tenantPrefix = String(key).split(":", 1)[0];
      if (staleTenantIds.has(tenantPrefix)) {
        combinedPromptCache.delete(key);
        deleted.combinedPrompt++;
      }
    }
  }

  const after = {
    tenant: tenantCache.size,
    conversation: conversationCache.size,
    dataset: datasetCache.size,
    prompt: promptCache.size,
    combinedPrompt: combinedPromptCache.size,
  };
  const afterTotal =
    after.tenant +
    after.conversation +
    after.dataset +
    after.prompt +
    after.combinedPrompt;

  const reduced = beforeTotal - afterTotal;
  const reducedPct = beforeTotal > 0 ? (reduced / beforeTotal) * 100 : 0;

  return {
    skipped: false,
    budget,
    deleted_tenants: deleted.tenants,
    deleted_ratio: `${deleted.tenants}/${budget}`,
    stale_window_ms: staleWindowMs,
    scanned_tenant_entries: scannedTenantEntries,
    candidates_found: candidates.length,
    deleted_entries: deleted,
    before,
    after,
    before_total: beforeTotal,
    after_total: afterTotal,
    reduced_total: reduced,
    reduced_pct: Number(reducedPct.toFixed(1)),
  };
}

module.exports = {
  // Conversation cache
  getCachedConversation,
  setCachedConversation,

  // Timestamp normalization function
  normalizeTimestamp,

  // Dataset cache
  getCachedDataset,
  setCachedDataset,
  getCachedDatasets,

  // Prompt cache
  getCachedPrompt,
  setCachedPrompt,
  getPromptTimestamp,
  deleteCachedPrompt,

  // Global prompt cache
  getCachedGlobalPrompt,
  setCachedGlobalPrompt,

  // Combined prompt cache
  getCachedCombinedPrompt,
  setCachedCombinedPrompt,

  // Tenant cache
  getCachedTenant,
  setCachedTenant,
  deleteCachedTenant,

  // Init mode cache cleanup
  cleanupStaleTenantsOnInit,

  // Constants
  CACHE_TTL_MS,
  PROMPT_CACHE_TTL_MS,
  INIT_CACHE_CLEANUP_BUDGET,
  INIT_CACHE_CLEANUP_STALE_WINDOW_MS,
  INIT_CACHE_CLEANUP_SCAN_LIMIT,
  INIT_CACHE_CLEANUP_MIN_INTERVAL_MS
};