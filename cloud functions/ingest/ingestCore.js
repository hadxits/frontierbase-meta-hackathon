/**
 * ============================================================================
 * ingest-worker (tenant + dataset-aware) — Incremental Upsert/Delete
 * ============================================================================
 *
 * This worker reads JSONL files stored in GCS (Google Cloud Storage)
 * Converts text to embedding vectors and stores them in the Qdrant vector database.
 *
 * Key features:
 * 1) Incremental Upsert/Delete method
 *    - Compares with existing row_id to classify additions/deletions
 *    - Deleted rows are removed from Qdrant (managed via JSONL, no Firestore needed)
 *    - New rows are upserted into Qdrant
 *    - Note: rowId is based on column values, so if column values change, rowId changes causing delete then add (no update)
 *
 * 2) One Qdrant collection per tenant: {base}__{tenant}
 *    Example: base="cm_chunks", tenant="hadfamily" → collection="cm_chunks__hadfamily"
 *    - Datasets are distinguished by payload and queried via filters
 *    - Multiple datasets' data stored in one collection
 *
 * 3) Embedding model is passed as env variable at execute time (EMBED_MODEL)
 *    Example: "text-embedding-3-small", "text-embedding-3-large"
 *
 * 4) Qdrant payload stores original text (text) + normalized text (embedding_text) + version + light row metadata
 *    - payload: tenant, dataset, row_id, embed_model, text, embedding_text, version, row_kind_guess, is_long_text, has_section_marker, policy_like, faq_like
 *    - Storing original text and version in payload avoids Firestore lookup during RAG search
 *    - Improves search performance and reduces network calls
 *
 * 5) QDRANT_URL is a required environment variable
 *    Example: "http://localhost:6333" or "https://qdrant.example.com"
 *
 * 5b) DATASET_LOCALE (optional): tenant language (ko, en, etc.). Passed by Cloud Functions when enqueueing.
 *     On failure, save user message in Firestore dataset.error using this locale.
 *
 * 6) Validation and checks
 *    - uploadDataset.js already checks token limits, MAX_ROWS, MAX_TEXT_CHARS
 *    - worker.js additionally revalidates canonical JSONL and applies delete-only/no-op guards
 *
 * Execution:
 * - Runs as Cloud Run Job via executeWorker function in uploadDataset.js
 * - Does not run independently
 *
 * Process flow:
 * 1. Read and validate environment variables
 * 2. Update Dataset status to indexing
 * 3. Download JSONL file from GCS
 *    - GCS_PATH: actual work file (only toAdd, newly added rows)
 *    - FULL_GCS_PATH: for detecting deletions (all newRows, if present)
 * 3.5. Check/create Qdrant collection (create if missing to prevent scroll 404 for new tenants)
 * 4. Parse JSONL (extract row_id, text, version, optional meta and verify canonical form)
 * 5. Query existing row_id in Qdrant
 * 6. Classify add/update/delete
 *    - Delete: row_id not in FULL_GCS_PATH (or GCS_PATH)
 *    - Add/update: all rows in GCS_PATH (only changed ones)
 * 7. Convert text to embedding vectors (batch, only changed rows)
 * 8. Check/create Qdrant collection
 * 9. Process deleted rows (delete from Qdrant)
 * 10. Upsert new rows
 * 11. Update Dataset status to ready (job complete)
 * 12. Save jsonl_paths (only on success, used as oldJsonlPath on next upload)
 * ============================================================================
 */

const crypto = require("crypto");
const OpenAIModule = require("openai");
const OpenAI = OpenAIModule.default || OpenAIModule;
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const readline = require("readline");
const { storage } = require("../firebase");
const {
  captureError,
  captureMessage,
  flushSentry
} = require("../utils/sentry");
const {
  getWorkerLocalizedDatasetError,
  normalizeWorkerLocale
} = require("./workerDatasetErrors");

function sanitizeUrlForLog(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    // Never log user/password/query/fragment
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch (_) {
    // If URL() parsing fails, log only part of original text (length limited)
    return s.slice(0, 200);
  }
}

// ============================================================================
// Dataset status constants
// ============================================================================
// Use same values as cloud functions/const/DatasetStatus.js
const DatasetStatus = {
  /** Queue registered, waiting for worker to start */
  PROCESSING: "processing",
  /** Indexing in progress (embedding creation and Qdrant storage ongoing) */
  INDEXING: "indexing",
  /** Ready (indexing complete, available) */
  READY: "ready",
  /** Failed (error occurred or processing failed) */
  FAILED: "failed",
  /** Paused (excluded from search/conversation targets) */
  PAUSED: "paused",
  /** Deleted (dataset removed) */
  DELETED: "deleted"
};

// ============================================================================
// Control Sentry noise/cost (shared Sentry instance for Functions)
// ============================================================================
const __sentryLastSentAtByKey = new Map();

function shouldSendSentry({ key, sampleRate = 1.0, cooldownMs = 0 }) {
  if (!key) return true;
  const now = Date.now();
  const last = __sentryLastSentAtByKey.get(key) || 0;
  if (cooldownMs > 0 && now - last < cooldownMs) return false;
  if (sampleRate < 1.0 && Math.random() > sampleRate) return false;
  __sentryLastSentAtByKey.set(key, now);
  return true;
}

function captureErrorThrottled(error, context = {}, throttling = {}) {
  const key = throttling.key || context?.extra?.sentry_key || null;
  const sampleRate = throttling.sampleRate != null ? throttling.sampleRate : 1.0;
  const cooldownMs = throttling.cooldownMs != null ? throttling.cooldownMs : 0;
  if (!shouldSendSentry({ key, sampleRate, cooldownMs })) return;
  captureError(error, context);
}

// ============================================================================
// Billing Window calculation utility
// ============================================================================

/**
 * Find date matching startDay in current month or adjust to nearest previous valid date
 * @param {Date} now - current time
 * @param {number} startDay - desired day (1-31)
 * @returns {Date} - adjusted date
 */
function adjustDayInMonth(now, startDay) {
  const year = now.getFullYear();
  const month = now.getMonth();

  // Check last date of the month
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  // Check if startDay exists in the month
  let targetDay = startDay;
  if (startDay > lastDayOfMonth) {
    // If startDay doesn't exist in the month, adjust to last date
    targetDay = lastDayOfMonth;
  }

  return new Date(year, month, targetDay);
}

/**
 * Calculate billing window
 * @param {Date} now - current time
 * @param {number} startDay - Billing start day (1-31)
 * @param {Date|null} existingWindowStartAt - Existing windowStartAt (to preserve hour, minute, second)
 * @returns {{windowStartAt: Date, windowEndAt: Date}} - Calculated window
 */
function calculateBillingWindow(now, startDay, existingWindowStartAt = null) {
  // Calculate the startDay date of the current month (adjust if missing)
  const currentMonthStart = adjustDayInMonth(now, startDay);

  // windowStartAt: startDay of the current month
  let windowStartAt = new Date(currentMonthStart);

  // If existing windowStartAt exists, preserve hour, minute, second (passed as Date object)
  if (existingWindowStartAt) {
    const existingDate = existingWindowStartAt instanceof Date
      ? existingWindowStartAt
      : new Date(existingWindowStartAt);
    windowStartAt.setHours(existingDate.getHours());
    windowStartAt.setMinutes(existingDate.getMinutes());
    windowStartAt.setSeconds(existingDate.getSeconds());
    windowStartAt.setMilliseconds(existingDate.getMilliseconds());
  } else {
    // If no existing value, set to 00:00:00
    windowStartAt.setHours(0, 0, 0, 0);
  }

  // windowEndAt: startDay of the next month (adjust if missing)
  const nextMonth = new Date(currentMonthStart);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStart = adjustDayInMonth(nextMonth, startDay);

  let windowEndAt = new Date(nextMonthStart);
  // Set windowEndAt's hour, minute, second to match windowStartAt
  windowEndAt.setHours(windowStartAt.getHours());
  windowEndAt.setMinutes(windowStartAt.getMinutes());
  windowEndAt.setSeconds(windowStartAt.getSeconds());
  windowEndAt.setMilliseconds(windowStartAt.getMilliseconds());

  return {
    windowStartAt,
    windowEndAt
  };
}

/**
 * Check if billing window has expired
 * @param {number|Date} windowEndAt - Window end time (timestamp or Date)
 * @param {Date} now - current time
 * @returns {boolean} - Whether expired
 */
function isBillingWindowExpired(windowEndAt, now) {
  const endTime =
    windowEndAt instanceof Date
      ? windowEndAt.getTime()
      : typeof windowEndAt === "number"
        ? windowEndAt
        : new Date(windowEndAt).getTime();
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return nowTime >= endTime;
}

/**
 * Generate billingKey
 * @param {number|Date} windowStartAt - Window start time
 * @param {number|Date} windowEndAt - Window end time
 * @returns {string} - billingKey (e.g., "1767686567271_1767686567272")
 */
function generateBillingKey(windowStartAt, windowEndAt) {
  const startTime =
    windowStartAt instanceof Date
      ? windowStartAt.getTime()
      : typeof windowStartAt === "number"
        ? windowStartAt
        : new Date(windowStartAt).getTime();
  const endTime =
    windowEndAt instanceof Date
      ? windowEndAt.getTime()
      : typeof windowEndAt === "number"
        ? windowEndAt
        : new Date(windowEndAt).getTime();
  return `${startTime}_${endTime}`;
}

/**
 * Convert date to YYYY-MM-DD format
 * @param {Date} date - Date
 * @returns {string} - String in YYYY-MM-DD format
 */
function formatDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ============================================================================
// Addon token management functions
// ============================================================================

/**
 * F2) Calculate current addon "balance (available tokens)"
 * @param {Array} addonTokenArray - Array of addon_token
 * @param {number} currentTime - Current time (timestamp, milliseconds)
 * @returns {number} - Total available addon tokens
 */
function getAddonAvailableTokens(addonTokenArray, currentTime = Date.now()) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0) {
    return 0;
  }

  return addonTokenArray
    .filter((addon) => {
      if (!addon) return false;

      const isActive = addon.status === "active";
      const isNotExpired =
        addon.active_pack_expires_at &&
        addon.active_pack_expires_at > currentTime;

      return isActive && isNotExpired;
    })
    .reduce((sum, addon) => {
      const balance = addon.token_balance || 0;
      const used = addon.token_used || 0;
      const available = Math.max(0, balance - used);
      return sum + available;
    }, 0);
}

/**
 * F5) Expiration handling - Change status of expired addons to "expired"
 * @param {Array} addonTokenArray - Array of addon_token
 * @param {number} currentTime - Current time (timestamp, milliseconds)
 * @returns {Array} - Updated addon_token array
 */
function processAddonExpiration(addonTokenArray, currentTime = Date.now()) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0) {
    return addonTokenArray;
  }

  let hasChanges = false;
  const updated = addonTokenArray.map((addon) => {
    if (!addon) return addon;

    if (
      addon.status === "active" &&
      addon.active_pack_expires_at &&
      addon.active_pack_expires_at <= currentTime
    ) {
      hasChanges = true;
      return {
        ...addon,
        status: "expired",
        updated_at: currentTime
      };
    }

    return addon;
  });

  return hasChanges ? updated : addonTokenArray;
}

/**
 * F6) Depletion handling - Change status of depleted addons to "depleted"
 * @param {Array} addonTokenArray - Array of addon_token
 * @returns {Array} - Updated addon_token array
 */
function processAddonDepletion(addonTokenArray) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0) {
    return addonTokenArray;
  }

  let hasChanges = false;
  const currentTime = Date.now();

  const updated = addonTokenArray.map((addon) => {
    if (!addon) return addon;

    const balance = addon.token_balance || 0;
    const used = addon.token_used || 0;

    if (addon.status === "active" && used >= balance) {
      hasChanges = true;
      return {
        ...addon,
        status: "depleted",
        updated_at: currentTime
      };
    }

    return addon;
  });

  return hasChanges ? updated : addonTokenArray;
}

/**
 * Expiration and depletion handling (F5 + F6)
 * @param {Array} addonTokenArray - Array of addon_token
 * @param {number} currentTime - Current time (timestamp, milliseconds)
 * @returns {Array} - Updated addon_token array
 */
function processAddonStatus(addonTokenArray, currentTime = Date.now()) {
  let updated = processAddonExpiration(addonTokenArray, currentTime);
  updated = processAddonDepletion(updated);
  return updated;
}

/**
 * Process addon token usage
 * @param {Array} addonTokenArray - Array of addon_token
 * @param {number} tokenCount - Number of tokens to use
 * @param {number} currentTime - Current time (timestamp, milliseconds)
 * @returns {Object} - { updated: Array, usedFromAddon: number, remaining: number }
 */
function consumeAddonTokens(
  addonTokenArray,
  tokenCount,
  currentTime = Date.now()
) {
  if (
    !Array.isArray(addonTokenArray) ||
    addonTokenArray.length === 0 ||
    tokenCount <= 0
  ) {
    return {
      updated: addonTokenArray || [],
      usedFromAddon: 0,
      remaining: tokenCount
    };
  }

  const activeAddons = addonTokenArray
    .map((addon, index) => ({ addon, index }))
    .filter(({ addon }) => {
      if (!addon) return false;
      const isActive = addon.status === "active";
      const isNotExpired =
        addon.active_pack_expires_at &&
        addon.active_pack_expires_at > currentTime;
      const hasBalance =
        (addon.token_balance || 0) - (addon.token_used || 0) > 0;
      return isActive && isNotExpired && hasBalance;
    })
    .sort((a, b) => {
      const expiresA = a.addon.active_pack_expires_at || 0;
      const expiresB = b.addon.active_pack_expires_at || 0;
      return expiresA - expiresB;
    });

  if (activeAddons.length === 0) {
    return {
      updated: addonTokenArray,
      usedFromAddon: 0,
      remaining: tokenCount
    };
  }

  let remaining = tokenCount;
  let usedFromAddon = 0;
  const updated = [...addonTokenArray];

  for (const { addon, index } of activeAddons) {
    if (remaining <= 0) break;

    const balance = addon.token_balance || 0;
    const used = addon.token_used || 0;
    const available = balance - used;

    if (available > 0) {
      const toUse = Math.min(remaining, available);
      const newUsed = used + toUse;

      updated[index] = {
        ...addon,
        token_used: newUsed,
        updated_at: currentTime,
        status: newUsed >= balance ? "depleted" : addon.status
      };

      usedFromAddon += toUse;
      remaining -= toUse;
    }
  }

  return {
    updated,
    usedFromAddon,
    remaining
  };
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Parse GCS path
 * Split GCS path into bucket and file name.
 *
 * @param {string} gsPath - GCS path (e.g., "gs://bucket-name/path/to/file.jsonl")
 * @returns {{bucket: string, name: string}} - Bucket name and file path
 * @throws {Error} - If path is invalid
 *
 * Example:
 * parseGsPath("gs://my-bucket/data/file.jsonl")
 * → { bucket: "my-bucket", name: "data/file.jsonl" }
 */
function parseGsPath(gsPath) {
  const m = gsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Invalid GCS_PATH: ${gsPath}`);
  return { bucket: m[1], name: m[2] };
}

function buildCanonicalRowFromJsonlObject(obj) {
  const rowId = String(obj?.row_id ?? "").trim();
  const text = String(obj?.text ?? "").trim();
  const parsedVersion = Number(obj?.version);
  const version =
    parsedVersion > 0 && Number.isInteger(parsedVersion) ? parsedVersion : 1;
  const rowMeta =
    obj?.meta && typeof obj.meta === "object" && !Array.isArray(obj.meta)
      ? {
        row_kind_guess:
          typeof obj.meta.row_kind_guess === "string"
            ? obj.meta.row_kind_guess
            : "unknown",
        is_long_text: obj.meta.is_long_text === true,
        has_section_marker: obj.meta.has_section_marker === true,
        policy_like: obj.meta.policy_like === true,
        faq_like: obj.meta.faq_like === true,
        list_like: obj.meta.list_like === true,
        record_like: obj.meta.record_like === true
      }
      : null;
  if (!rowId) return { row: null, reason: "missing_row_id" };
  if (!text) return { row: null, reason: "missing_text" };
  return {
    row: {
      rowId,
      text,
      version,
      rowMeta
    },
    reason: null
  };
}

/**
 * Read JSONL from GCS as stream and convert to rows (row_id, text, version) array
 * - Use createReadStream + readline instead of full download to reduce memory usage
 */
async function readJsonlRowsFromGcs(storage, gsPath, tenantId = null, datasetId = null) {
  try {
    const { bucket, name } = parseGsPath(gsPath);
    const stream = storage.bucket(bucket).file(name).createReadStream();
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const rows = [];
    const issues = {
      invalid_json_lines: 0,
      missing_row_id_lines: 0,
      missing_text_lines: 0
    };
    for await (const line of rl) {
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;
      const obj = safeJsonParse(trimmed);
      if (!obj) {
        issues.invalid_json_lines += 1;
        continue;
      }
      const parsed = buildCanonicalRowFromJsonlObject(obj);
      if (!parsed.row) {
        if (parsed.reason === "missing_row_id") issues.missing_row_id_lines += 1;
        if (parsed.reason === "missing_text") issues.missing_text_lines += 1;
        continue;
      }
      rows.push(parsed.row);
    }
    if (
      issues.invalid_json_lines > 0 ||
      issues.missing_row_id_lines > 0 ||
      issues.missing_text_lines > 0
    ) {
      throw new Error(
        `Invalid canonical JSONL rows detected: ${JSON.stringify(issues)}`
      );
    }
    return rows;
  } catch (e) {
    const err = new Error(
      `Failed to read JSONL from GCS (rows): ${gsPath}. ${e?.message || String(e)}`
    );
    err.cause = e;
    captureErrorThrottled(err, {
      tenant_id: tenantId || "empty",
      function_name: "readJsonlRowsFromGcs",
      extra: {
        dataset_id: datasetId || null,
        gs_path: gsPath,
        operation: "gcs_jsonl_stream_rows"
      }
    }, { key: `gcs_jsonl_rows:${tenantId || "empty"}:${gsPath}`, cooldownMs: 30_000 });
    throw err;
  }
}

/**
 * Read JSONL from GCS as stream and collect row_id Set + count of valid rows only
 * - To avoid loading text into memory unnecessarily in FULL_GCS_PATH (for deletion tracking)
 */
async function readJsonlRowIdsAndCountFromGcs(storage, gsPath, tenantId = null, datasetId = null) {
  try {
    const { bucket, name } = parseGsPath(gsPath);
    const stream = storage.bucket(bucket).file(name).createReadStream();
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const rowIds = new Set();
    let rowsCount = 0;
    const issues = {
      invalid_json_lines: 0,
      missing_row_id_lines: 0,
      missing_text_lines: 0
    };
    for await (const line of rl) {
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;
      const obj = safeJsonParse(trimmed);
      if (!obj) {
        issues.invalid_json_lines += 1;
        continue;
      }
      const parsed = buildCanonicalRowFromJsonlObject(obj);
      if (!parsed.row) {
        if (parsed.reason === "missing_row_id") issues.missing_row_id_lines += 1;
        if (parsed.reason === "missing_text") issues.missing_text_lines += 1;
        continue;
      }
      rowIds.add(parsed.row.rowId);
      rowsCount += 1;
    }
    if (
      issues.invalid_json_lines > 0 ||
      issues.missing_row_id_lines > 0 ||
      issues.missing_text_lines > 0
    ) {
      throw new Error(
        `Invalid canonical JSONL rows detected: ${JSON.stringify(issues)}`
      );
    }
    return { rowIds, rowsCount };
  } catch (e) {
    const err = new Error(
      `Failed to read JSONL from GCS (row_ids): ${gsPath}. ${e?.message || String(e)}`
    );
    err.cause = e;
    captureErrorThrottled(err, {
      tenant_id: tenantId || "empty",
      function_name: "readJsonlRowIdsAndCountFromGcs",
      extra: {
        dataset_id: datasetId || null,
        gs_path: gsPath,
        operation: "gcs_jsonl_stream_row_ids"
      }
    }, { key: `gcs_jsonl_rowids:${tenantId || "empty"}:${gsPath}`, cooldownMs: 30_000 });
    throw err;
  }
}

/**
 * Convert a hexadecimal string to UUID format (deterministic)
 * Convert a hexadecimal string (32 or 40 characters) to UUID format.
 * Qdrant only supports UUID or uint, so this conversion is required.
 *
 * @param {string} hex - Hexadecimal string (32 or 40 characters)
 * @returns {string} - UUID format string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 *
 * Example:
 * hexToUuid("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d") // 40 characters
 * → "aaf4c61d-dcc5-e8a2-dabe-de0f3b482cd9"
 * hexToUuid("aaf4c61ddcc5e8a2dabede0f3b482cd") // 32 characters
 * → "aaf4c61d-dcc5-e8a2-dabe-de0f3b482cd"
 */
function hexToUuid(hex) {
  const raw = String(hex || "");
  const isHex = /^[0-9a-f]+$/i.test(raw);
  // If not hex, generate deterministic hex via sha256 (ensures UUID format)
  const normalizedHex = isHex
    ? raw
    : crypto.createHash("sha256").update(raw).digest("hex");
  const h = normalizedHex.slice(0, 32).padEnd(32, "0"); // Adjust to 32 characters (pad with zeros if needed)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(
    16,
    20
  )}-${h.slice(20, 32)}`;
}

/**
 * Sanitize collection name
 * Sanitize a string to be used as a Qdrant collection name.
 * - Convert to lowercase
 * - Allow only letters, digits, and underscores (convert others to underscore)
 * - Remove leading and trailing underscores
 * - Limit to 60 characters max
 *
 * @param {string} s - Original string
 * @returns {string} - Sanitized collection name
 *
 * Example:
 * toSafeCollectionName("My-Tenant@123")
 * → "my_tenant_123"
 *
 * toSafeCollectionName("  HadFamily  ")
 * → "hadfamily"
 */
function toSafeCollectionName(s) {
  return (s || "")
    .toLowerCase() // Convert to lowercase
    .replace(/[^a-z0-9_]+/g, "_") // Convert special characters to underscore
    .replace(/^_+|_+$/g, "") // Remove leading and trailing underscores
    .slice(0, 60); // Limit to 60 characters max
}

/**
 * Create sparse vector for BM25 (same logic used in worker and cloud functions)
 * After tokenization, map term to (index, weight). Index is hash-based uint32, weight is 1+log(tf).
 *
 * @param {string} text - Original text
 * @returns {{ indices: number[], values: number[] }} - Qdrant sparse format (indices sorted ascending)
 */
function textToBm25Sparse(text) {
  if (!text || typeof text !== "string") {
    return { indices: [], values: [] };
  }
  // Multilingual/mixed language tokenization:
  // - Latin (English/European): accent folding + [a-z0-9] word tokens (length >= 2)
  // - Hangul (Korean): Hangul tokens (length >= 1)
  // - CJK (Japanese/Chinese): no spaces, so use character bigrams plus short sequence tokens
  // ⚠️ Must keep identical logic with cloud functions/utils/qdrant.js
  const MAX_TOKENS = 512; // Prevent excessive token explosion
  const MAX_CJK_NGRAMS = 384;
  const MAX_LATIN_TOKENS = 192;
  const MAX_HANGUL_TOKENS = 192;

  const nfkc = text.normalize("NFKC").toLowerCase();

  // Latin: decompose accents with NFKD and remove combining marks → fold é/ö/ñ etc.
  const latinFold = nfkc.normalize("NFKD").replace(/\p{M}+/gu, "");
  const latinTokensRaw = latinFold.match(/[a-z0-9]{2,}/g) || [];
  const latinTokens = latinTokensRaw.slice(0, MAX_LATIN_TOKENS);

  // Hangul: tokens combining Korean syllables (U+AC00-U+D7A3) with digits
  const hangulTokensRaw = nfkc.match(/[가-힣0-9]+/g) || [];
  const hangulTokens = hangulTokensRaw
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, MAX_HANGUL_TOKENS);

  // CJK sequences (hiragana/katakana/kanji/half-width katakana)
  const cjkSeqs =
    nfkc.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff65-\uff9f]+/g) ||
    [];
  const cjkTokens = [];
  let cjkNgrams = 0;
  for (const seq of cjkSeqs) {
    const s = String(seq || "").trim();
    if (!s) continue;

    // Add short segments as tokens directly (e.g., ダッシュボード, 設定)
    if (s.length >= 2 && s.length <= 12) cjkTokens.push(s);
    if (s.length === 1) cjkTokens.push(s);

    // Character bigrams (fallback for CJK only)
    for (let i = 0; i < s.length - 1; i++) {
      cjkTokens.push(s.slice(i, i + 2));
      cjkNgrams++;
      if (cjkNgrams >= MAX_CJK_NGRAMS) break;
    }
    if (cjkNgrams >= MAX_CJK_NGRAMS) break;
  }

  const tokens = [...latinTokens, ...hangulTokens, ...cjkTokens].slice(0, MAX_TOKENS);
  if (tokens.length === 0) {
    return { indices: [], values: [] };
  }
  // term frequency
  const tf = new Map();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  // Hash: djb2 (string to uint32, same in worker/cloud)
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = (h * 33 + s.charCodeAt(i)) >>> 0;
    }
    return h >>> 0;
  }
  const byIndex = new Map();
  for (const [term, count] of tf) {
    const idx = hashStr(term);
    const weight = 1 + Math.log(count);
    const prev = byIndex.get(idx) || 0;
    byIndex.set(idx, prev + weight);
  }
  const indices = [];
  const values = [];
  for (const [idx, val] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    indices.push(idx);
    values.push(val);
  }
  return { indices, values };
}

function normalizeEmbeddingLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

function extractValueFocusedSegment(segment) {
  const normalized = normalizeEmbeddingLine(segment);
  if (!normalized) return null;
  const match = normalized.match(/^(.{1,40}?)(?:\s*[:=]\s*|\t+)(.+)$/u);
  if (!match) return null;
  const keyPart = normalizeEmbeddingLine(match[1]);
  const valuePart = normalizeEmbeddingLine(match[2]);
  if (!keyPart || !valuePart) return null;
  if (keyPart.length >= valuePart.length) return null;
  return valuePart;
}

function buildValueFocusedEmbeddingText(text) {
  const normalizedLines = String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeEmbeddingLine(line))
    .filter((line) => line.length > 0);
  if (normalizedLines.length === 0) return "";

  const extractedValueLines = normalizedLines
    .map((line) => extractValueFocusedSegment(line))
    .filter(Boolean);

  // Only convert row.text to value-focused representation if it has repeated "key: value" structure
  // Reduce repeated label/header noise in dense embeddings.
  const shouldPreferValueFocusedText =
    extractedValueLines.length >= 2 &&
    extractedValueLines.length / normalizedLines.length >= 0.6;

  return shouldPreferValueFocusedText
    ? extractedValueLines.join("\n")
    : normalizedLines.join("\n");
}

function buildEmbeddingDataFromRowText(text) {
  if (!text || typeof text !== "string") {
    return { embeddingText: "" };
  }
  const embeddingText = buildValueFocusedEmbeddingText(text);

  return { embeddingText };
}

/**
 * Timestamp normalization function
 * Converts Firestore Timestamp object or number (milliseconds) into a consistent number.
 *
 * @param {number|Object|Date|null} ts - Timestamp (number, Timestamp object, Date object)
 * @returns {number|null} - Number in milliseconds or null
 *
 * Example:
 * normalizeTimestamp(1768733676000) → 1768733676000
 * normalizeTimestamp({ toMillis: () => 1768733676000 }) → 1768733676000
 * normalizeTimestamp({ _seconds: 1768733676 }) → 1768733676000
 */
function normalizeTimestamp(ts) {
  if (ts === null || ts === undefined) return null;
  if (typeof ts === "number") return ts;
  if (ts.toMillis) return ts.toMillis(); // Firestore Timestamp
  if (ts._seconds) return ts._seconds * 1000; // Firestore Timestamp (raw)
  if (ts instanceof Date) return ts.getTime();
  return null;
}

/**
 * Asynchronous wait function
 * Waits for the specified time (milliseconds).
 *
 * @param {number} ms - Wait time (milliseconds)
 * @returns {Promise<void>} - Resolves after waiting
 *
 * Example:
 * await sleep(1000);  // Wait 1 second
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Exponential backoff retry (network/temporary failure/timeout)
 * @param {(attempt:number)=>Promise<any>} fn
 * @param {object} options
 */
async function retryWithBackoff(fn, options = {}) {
  const maxRetries = Number(options.maxRetries ?? 3);
  const initialDelayMs = Number(options.initialDelayMs ?? 800);
  const maxDelayMs = Number(options.maxDelayMs ?? 10000);
  const backoffMultiplier = Number(options.backoffMultiplier ?? 2);
  const label = options.label || "retryWithBackoff";
  const tenantId = options.tenantId || null;

  let delay = initialDelayMs;
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (e) {
      const retryable = isRetryableError(e);
      if (!retryable || attempt >= maxRetries) {
        throw e;
      }
      attempt += 1;
      console.warn("transient_retry", {
        label,
        tenant: tenantId || "empty",
        attempt,
        maxRetries,
        delay_ms: delay,
        message: e?.message || String(e)
      });
      await sleep(delay);
      delay = Math.min(maxDelayMs, delay * backoffMultiplier);
    }
  }
}

/**
 * Safe JSON parsing
 * Parses a JSON string and returns null if an error occurs.
 *
 * @param {string} line - JSON string
 * @returns {object|null} - Parsed object or null
 *
 * Example:
 * safeJsonParse('{"key": "value"}')
 * → { key: "value" }
 *
 * safeJsonParse('invalid json')
 * → null
 */
function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function addVectorsInPlace(target, vec) {
  for (let i = 0; i < target.length; i++) target[i] += vec[i] || 0;
}

function subVectorsInPlace(target, vec) {
  for (let i = 0; i < target.length; i++) target[i] -= vec[i] || 0;
}

function scaleVector(vec, scalar) {
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = (vec[i] || 0) * scalar;
  return out;
}

const EMBED_VALUE_BASIS = "qdrant_cosine_v1";

// Use the same float32 unit vector for storage and averaging to avoid mixing raw/stored bases in increments.
function toStoredCosineVector(vector) {
  const stored = vector.map(value => Math.fround(value));
  const squaredNorm = stored.reduce((sum, value) => sum + value * value, 0);
  if (!Number.isFinite(squaredNorm)) throw new Error("Invalid embedding vector values");
  // Qdrant treats vectors smaller than this size as zero vectors and does not normalize them.
  if (squaredNorm < 1.1920928955078125e-7) return stored;
  const inverseNorm = 1 / Math.sqrt(squaredNorm);
  return stored.map(value => Math.fround(value * inverseNorm));
}

function normalizeEmbeddingVector(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  // Qdrant named vectors: { embedding: [...] }
  if (Array.isArray(v.embedding)) return v.embedding;
  if (Array.isArray(v?.vector?.embedding)) return v.vector.embedding;
  if (Array.isArray(v?.vectors?.embedding)) return v.vectors.embedding;
  return null;
}

function safePreviewArrayLengths(v) {
  if (!v) return null;
  if (Array.isArray(v)) return { kind: "array", length: v.length };
  const emb = normalizeEmbeddingVector(v);
  if (Array.isArray(emb)) return { kind: "named", length: emb.length };
  return { kind: typeof v, length: null };
}

function meanVector(vectors, dim) {
  if (!vectors || vectors.length === 0) return null;
  const d = dim || vectors[0]?.length || 0;
  if (!d) return null;
  const sum = new Array(d).fill(0);
  for (const v of vectors) addVectorsInPlace(sum, v);
  for (let i = 0; i < d; i++) sum[i] /= vectors.length;
  return sum;
}

function sampleArray(arr, k) {
  const n = arr.length;
  if (k >= n) return [...arr];
  // Fisher-Yates partial shuffle
  const copy = [...arr];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, k);
}

// During retries, Qdrant may have partially applied data, so restore the average to the current vector after completion.
async function readDatasetMeanEmbedding(qdrant, collection, { tenant, dataset, vectorSize }) {
  const sum = new Array(vectorSize).fill(0);
  let count = 0;
  let offset = null;
  const seenOffsets = new Set();
  do {
    const response = await qdrant.qdrantFetch(`/collections/${collection}/points/scroll`, {
      method: "POST",
      body: {
        filter: { must: [
          { key: "tenant", match: { value: tenant } },
          { key: "dataset", match: { value: dataset } }
        ] },
        limit: 256,
        with_payload: false,
        with_vector: true,
        offset
      }
    });
    const page = response?.result;
    if (!Array.isArray(page?.points)) throw new Error("Invalid Qdrant mean recovery response");
    for (const point of page.points) {
      const vector = normalizeEmbeddingVector(point?.vector || point?.vectors);
      if (!vector || vector.length !== vectorSize || !vector.every(Number.isFinite)) {
        throw new Error("Invalid embedding vector during mean recovery");
      }
      addVectorsInPlace(sum, vector);
      count += 1;
    }
    offset = page.next_page_offset ?? null;
    if (offset !== null) {
      const key = JSON.stringify(offset);
      if (seenOffsets.has(key)) throw new Error("Repeated Qdrant mean recovery offset");
      seenOffsets.add(key);
    }
  } while (offset !== null);
  return {
    embedValue: count > 0 ? sum.map(value => value / count) : null,
    embedValueCount: count
  };
}

// ============================================================================
// Qdrant client (uses resolved URL)
// ============================================================================

/**
 * Create Qdrant client
 * Returns functions to communicate with the Qdrant API.
 *
 * @param {string} qdrantUrl - Qdrant server URL (e.g., "http://localhost:6333")
 * @param {string} tenantId - Tenant ID (for error logging)
 * @returns {object} - Qdrant API functions
 */
function makeQdrantClient(qdrantUrl, tenantId = null, invocationSignal = null) {
  /**
   * Qdrant API request (internal function)
   * Sends an HTTP request to the Qdrant REST API.
   *
   * @param {string} path - API path (e.g., "/collections/my_collection")
   * @param {object} options - Request options
   * @param {string} options.method - HTTP method (GET, POST, PUT, etc.)
   * @param {object} options.body - Request body (JSON object)
   * @returns {Promise<object|null>} - Response data (parsed JSON)
   * @throws {Error} - On request failure
   *
   * Example:
   * await qdrantFetch("/collections/my_collection", { method: "GET" })
   * → { result: { ... } }
   */
  // tenantId is used from makeQdrantClient closure (no separate parameter needed)
  async function qdrantFetch(path, { method = "GET", body } = {}) {
    const timeoutMs = Number(process.env.QDRANT_TIMEOUT_MS || "30000");
    const maxRetries = Number(process.env.QDRANT_MAX_RETRIES || "3");
    const initialDelayMs = Number(
      process.env.QDRANT_RETRY_INITIAL_DELAY_MS || "800"
    );
    const maxDelayMs = Number(process.env.QDRANT_RETRY_MAX_DELAY_MS || "10000");

    return await retryWithBackoff(
      async (attempt) => {
        const controller = new AbortController();
        const requestSignal = invocationSignal
          ? AbortSignal.any([controller.signal, invocationSignal])
          : controller.signal;
        const timeoutId = timeoutMs
          ? setTimeout(() => controller.abort(), timeoutMs)
          : null;
        let res;
        try {
          res = await fetch(`${qdrantUrl}${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
            signal: requestSignal
          });
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }

        const text = await res.text();
        if (!res.ok) {
          const error = new Error(
            `Qdrant ${method} ${path} failed: ${res.status} ${text}`
          );
          error.status = res.status;

          // GET /collections/{name} 404 = collection not found (new). Not an error since ensureCollection creates it → only log
          const isCollectionNotFound404 =
            res.status === 404 &&
            method === "GET" &&
            /^\/collections\/[^/]+$/.test(path);
          if (isCollectionNotFound404) {
            console.log("qdrant_collection_not_found", {
              tenant: tenantId || "empty",
              method,
              path,
              message: "Collection does not exist yet, will be created"
            });
          } else {
            // Actual errors: log + Sentry
            console.error("qdrant_api_error", {
              tenant: tenantId || "empty",
              method,
              path,
              status: res.status,
              response: text
            });
            // During retries, do not send to Sentry to reduce noise (final failure sent in main() catch)
            const retryable = isRetryableError(error);
            if (!retryable || attempt >= maxRetries) {
              captureErrorThrottled(
                error,
                {
                  tenant_id: tenantId || "empty",
                  function_name: "qdrantFetch",
                  extra: {
                    method,
                    path,
                    status: res.status,
                    response: text?.slice(0, 500),
                    operation: "qdrant_api",
                    retry_attempt: attempt,
                    max_retries: maxRetries
                  }
                },
                {
                  key: `qdrant_api_error:${tenantId || "empty"}:${method}:${path}:${res.status}`,
                  cooldownMs: 60_000,
                  sampleRate: 0.5
                }
              );
            }
          }
          throw error;
        }
        return text ? JSON.parse(text) : null;
      },
      {
        maxRetries,
        initialDelayMs,
        maxDelayMs,
        label: "qdrantFetch",
        tenantId
      }
    );
  }

  /**
   * Check/create collection (hybrid: embedding + bm25)
   * If collection does not exist, create named vectors (embedding=dense, bm25=sparse).
   * If it exists, verify the dense vector size.
   *
   * @param {string} collection - Collection name
   * @param {number} vectorSize - Dense vector size (dimensions, e.g., 1536)
   * @returns {Promise<void>}
   */
  async function ensureCollection(collection, vectorSize) {
    const VECTOR_EMBEDDING = "embedding";
    const VECTOR_BM25 = "bm25";

    try {
      const info = await qdrantFetch(`/collections/${collection}`);
      const params = info?.result?.config?.params || {};
      const vectors = params.vectors || {};
      const sparseVectors = params.sparse_vectors || {};

      // Named vectors: verify embedding (dense) size
      const existingSize =
        vectors[VECTOR_EMBEDDING]?.size ?? vectors.size ?? vectors.default?.size;
      if (existingSize && Number(existingSize) !== Number(vectorSize)) {
        throw new Error(
          `Vector size mismatch for collection ${collection}: existing=${existingSize}, new=${vectorSize}. ` +
            `You must migrate to a new collection or keep embed model consistent.`
        );
      }
      if (!sparseVectors[VECTOR_BM25]) {
        throw new Error(
          `Collection ${collection} missing sparse vector "${VECTOR_BM25}". Recreate collection with hybrid schema.`
        );
      }
      return;
    } catch (e) {
      const msg = e?.message ?? String(e);
      // Schema/dimension mismatches should not be overwritten by creation → fail immediately
      if (msg.includes("Vector size mismatch") || msg.includes("missing sparse")) throw e;

      // Create only if collection does not exist (404)
      // - Network/permission/other errors should not proceed to creation as it makes root cause analysis difficult and may cause bigger errors
      const status = e?.status;
      if (status !== 404) throw e;
    }

    // Hybrid schema: embedding(dense) + bm25(sparse)
    await qdrantFetch(`/collections/${collection}`, {
      method: "PUT",
      body: {
        vectors: {
          [VECTOR_EMBEDDING]: {
            size: vectorSize,
            distance: "Cosine"
          }
        },
        sparse_vectors: {
          [VECTOR_BM25]: {}
        }
      }
    });
  }

  /**
   * Point insert/update (batch) — hybrid: vectors.embedding + vectors.bm25
   *
   * @param {string} collection - Collection name
   * @param {Array<object>} points - array of points
   * @param {string|number} points[].id - point ID (UUID or uint)
   * @param {object} points[].vector - named vectors: { embedding: number[], bm25: { indices, values } }
   * @param {object} points[].payload - metadata
   * @returns {Promise<void>}
   */
  async function upsertPoints(collection, points) {
    await qdrantFetch(`/collections/${collection}/points?wait=true`, {
      method: "PUT",
      body: { points }
    });
  }

  /**
   * Delete from vector DB by array of row_id
   * @param {string} collection - Collection name
   * @param {object} options - deletion options
   * @param {string} options.tenant - tenant ID
   * @param {string} options.dataset - dataset ID
   * @param {Array<string>} options.rowIds - array of row_ids to delete
   * @returns {Promise<void>}
   */
  async function deleteByRowIds(
    collection,
    { tenant, dataset: datasetId, rowIds }
  ) {
    if (rowIds.length === 0) return;

    // Delete in batches of 1000. Qdrant delete API only allows filter with PointsSelector,
    // minimum_should is not supported in filter → specify row_id with match.any.
    const DELETE_BATCH = 1000;
    for (let i = 0; i < rowIds.length; i += DELETE_BATCH) {
      const batch = rowIds.slice(i, i + DELETE_BATCH);

      const filter = {
        must: [
          { key: "tenant", match: { value: tenant } },
          { key: "dataset", match: { value: datasetId } },
          { key: "row_id", match: { any: batch } }
        ]
      };

      await qdrantFetch(`/collections/${collection}/points/delete?wait=true`, {
        method: "POST",
        body: { filter }
      });
    }
  }

  /**
   * Query existing row_id in Qdrant (using scroll API)
   * Retrieve all data via pagination (limit: 10000)
   * @param {string} collection - Collection name
   * @param {object} options - query options
   * @param {string} options.tenant - tenant ID
   * @param {string} options.dataset - dataset ID
   * @returns {Promise<Set<string>>} - set of row_ids
   */
  async function getExistingRowIdsFromQdrant(
    collection,
    { tenant, dataset: datasetId }
  ) {
    const rowIds = new Set();
    let offset = null;

    // limit: 10000 (recommended max for Qdrant scroll API)
    // Automatically paginate if over 10000 (using offset)
    const SCROLL_LIMIT = 10000;

    do {
      const result = await qdrantFetch(
        `/collections/${collection}/points/scroll`,
        {
          method: "POST",
          body: {
            filter: {
              must: [
                { key: "tenant", match: { value: tenant } },
                { key: "dataset", match: { value: datasetId } }
              ]
            },
            limit: SCROLL_LIMIT,
            with_payload: ["row_id"], // Fetch only row_id field (memory optimization)
            with_vector: false,
            offset
          }
        }
      );

      // Check if result.result.points is an array (empty array is valid response)
      if (Array.isArray(result?.result?.points)) {
        for (const p of result.result.points) {
          const id = p?.payload?.row_id;
          if (id) rowIds.add(id);
        }
        offset = result.result.next_page_offset;

        // If next_page_offset is null, no more data exists
        if (!offset) {
          break;
        }
      } else {
        // Stop if response structure is unexpected
        break;
      }
    } while (offset);

    return rowIds;
  }

  async function retrievePoints(collection, ids) {
    if (!ids || ids.length === 0) return [];
    const result = await qdrantFetch(`/collections/${collection}/points`, {
      method: "POST",
      body: {
        ids,
        with_payload: ["row_id", "tenant", "dataset"],
        with_vector: true
      }
    });
    return Array.isArray(result?.result) ? result.result : [];
  }

  /**
   * Retrieve "existing embedding vectors" for the row_id list.
   * - Used to update embed_value (average vector) consistency during incremental upload
   * @returns {Promise<Map<string, number[]>>} row_id -> embedding vector
   */
  async function getEmbeddingVectorsByRowIds(
    collection,
    { tenant, dataset: datasetId, rowIds }
  ) {
    const map = new Map();
    if (!rowIds || rowIds.length === 0) return map;
    const BATCH = 256;
    const want = new Set(rowIds.map((r) => String(r)));

    // 1) Retrieve by ids if possible (faster)
    try {
      for (let i = 0; i < rowIds.length; i += BATCH) {
        const batch = rowIds.slice(i, i + BATCH);
        const ids = batch.map((rid) => hexToUuid(rid));
        const points = await retrievePoints(collection, ids);
        for (const p of points) {
          const payload = p?.payload || {};
          const rid = payload.row_id;
          if (!rid || !want.has(String(rid))) continue;
          if (payload.tenant !== tenant || payload.dataset !== datasetId) continue;
          const named = p?.vector || p?.vectors;
          const finalVec = normalizeEmbeddingVector(named);
          if (finalVec && Array.isArray(finalVec) && finalVec.length > 0) {
            map.set(String(rid), finalVec);
          }
        }
      }
      return map;
    } catch (e) {
      console.warn("qdrant_retrieve_fallback_to_scroll", {
        tenant: tenantId || "empty",
        message: e?.message || String(e)
      });
    }

    // 2) Fallback to scroll(filter) if retrieve fails
    for (let i = 0; i < rowIds.length; i += BATCH) {
      const batch = rowIds.slice(i, i + BATCH);
      const result = await qdrantFetch(`/collections/${collection}/points/scroll`, {
        method: "POST",
        body: {
          filter: {
            must: [
              { key: "tenant", match: { value: tenant } },
              { key: "dataset", match: { value: datasetId } },
              { key: "row_id", match: { any: batch } }
            ]
          },
          limit: batch.length,
          with_payload: ["row_id"],
          with_vector: true
        }
      });

      const points = Array.isArray(result?.result?.points) ? result.result.points : [];
      for (const p of points) {
        const rid = p?.payload?.row_id;
        const named = p?.vector || p?.vectors;
        const finalVec = normalizeEmbeddingVector(named);
        if (rid && finalVec && Array.isArray(finalVec) && finalVec.length > 0) {
          map.set(String(rid), finalVec);
        }
      }
    }
    return map;
  }

  return {
    qdrantFetch,
    ensureCollection,
    upsertPoints,
    deleteByRowIds,
    getExistingRowIdsFromQdrant,
    getEmbeddingVectorsByRowIds
  };
}

// ============================================================================
// OpenAI embedding functions
// ============================================================================

/**
 * Embedding creation with retry logic
 * Retry OpenAI API calls with exponential backoff on failure.
 *
 * Retry strategy:
 * - Max retries: maxRetries (default: 5)
 * - Wait time: 800ms * 2^(attempt-1) + random jitter (0~300ms)
 * - Max wait time: 15 seconds
 *
 * @param {OpenAI} openai - OpenAI client instance
 * @param {object} options - options
 * @param {string} options.model - embedding model (e.g., "text-embedding-3-small")
 * @param {Array<string>} options.inputs - array of texts to embed
 * @param {number} options.maxRetries - Maximum number of retry attempts (default: 5)
 * @param {string} [options.tenantId] - Tenant ID (for logging, optional)
 * @returns {Promise<object>} - OpenAI API response
 * @throws {Error} - Throws when maximum retry attempts are exceeded
 *
 * Example:
 * await embedWithRetry(openai, {
 *   model: "text-embedding-3-small",
 *   inputs: ["Hello", "Nice to meet you"],
 *   maxRetries: 5
 * })
 * → { data: [{ embedding: [0.1, 0.2, ...] }, ...] }
 *
 * Example of retry wait times:
 * - attempt 1: 800ms + 0~300ms = 800~1100ms
 * - attempt 2: 1600ms + 0~300ms = 1600~1900ms
 * - attempt 3: 3200ms + 0~300ms = 3200~3500ms
 * - attempt 4: 6400ms + 0~300ms = 6400~6700ms
 * - attempt 5: 12800ms + 0~300ms = 12800~13100ms (capped at 15 seconds)
 */
async function embedWithRetry(
  openai,
  {
    model,
    inputs,
    maxRetries = 5,
    tenantId = null,
    expectedDim = null,
    signal = null
  }
) {
  let attempt = 0;
  const embedTimeoutMs = Number(process.env.EMBED_REQUEST_TIMEOUT_MS || "30000");
  while (true) {
    try {
      const requestController = new AbortController();
      const requestSignal = signal
        ? AbortSignal.any([requestController.signal, signal])
        : requestController.signal;
      const timeoutId = embedTimeoutMs
        ? setTimeout(
          () => requestController.abort(
            new Error(`OpenAI embedding request timed out (timeout: ${embedTimeoutMs}ms)`)
          ),
          embedTimeoutMs
        )
        : null;
      try {
        return await openai.embeddings.create({
          model,
          input: inputs,
          // Some OpenAI-compatible endpoints/proxies have been observed to reduce default dimensions (e.g., 384).
          // text-embedding-3-* supports the dimensions parameter, so specify expected dimensions to prevent mixing.
          ...(expectedDim ? { dimensions: expectedDim } : {}),
          encoding_format: "float"
        }, { signal: requestSignal });
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (e) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("Ingest invocation aborted");
      }
      // 4xx/client errors often won't be fixed by retries, so fail immediately.
      const status = Number(e?.status || e?.statusCode || 0);
      const msg = (e?.message || String(e)).toLowerCase();
      if (
        status === 400 ||
        status === 401 ||
        status === 403 ||
        msg.includes("invalid embedding vector dimension") ||
        msg.includes("embedding batch size mismatch")
      ) {
        throw e;
      }
      attempt += 1;
      if (attempt > maxRetries) {
        // Send error to Sentry when maximum retry attempts are exceeded.
        console.error("embed_max_retries_exceeded", {
          tenant: tenantId || "empty",
          attempt,
          maxRetries,
          message: e?.message ?? String(e),
          stack: e?.stack
        });
        captureError(e, {
          tenant_id: tenantId || "empty",
          function_name: "embedWithRetry",
          extra: {
            attempt,
            maxRetries,
            operation: "embedding",
            message: "Embedding failed after max retries"
          }
        });
        throw e; // Throw error when maximum retry attempts are exceeded.
      }

      // Calculate exponential backoff.
      const base = 800 * Math.pow(2, attempt - 1); // 800, 1600, 3200, ...
      const jitter = Math.floor(Math.random() * 300); // Add 0~300ms random jitter.
      const wait = Math.min(15000, base + jitter); // Limit to a maximum of 15 seconds.

      console.warn("embed_retry", {
        tenant: tenantId || "empty",
        attempt,
        wait_ms: wait,
        message: e?.message ?? String(e)
      });
      await sleep(wait); // Wait before retrying
    }
  }
}

/**
 * Create embeddings in batches.
 * Generate embeddings by splitting large amounts of text into batches.
 * OpenAI API can handle up to 2048 items at once,
 * but for stability, it defaults to batching in groups of 64.
 *
 * Example:
 * await embedInBatches(openai, {
 *   model: "text-embedding-3-small",
 *   texts: ["text1", "text2", ..., "text200"],
 *   batchSize: 64,
 *   maxRetries: 5
 * })
 * → [
 *     [0.1, 0.2, ...],  // embedding for text1 (1536 dimensions)
 *     [0.3, 0.4, ...],  // embedding for text2
 *     ...
 *   ]
 *
 * Process flow:
 * - 200 texts, batchSize=64 → 4 batches (64, 64, 64, 8)
 * - Process each batch sequentially.
 * - Merge all vectors into a single array and return.
 */
async function embedInBatches(
  openai,
  {
    model,
    texts,
    batchSize = 64,
    maxRetries = 5,
    expectedDim = null,
    signal = null
  },
  tenantId = null // For logging (optional).
) {
  const vectors = new Array(texts.length);
  let totalTokens = 0; // Track total token usage (summed after completion).
  const concurrency = Math.max(
    1,
    Number(process.env.EMBED_CONCURRENCY || "1")
  );

  // Create list of batch jobs.
  const batches = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push({ start: i, batch: texts.slice(i, i + batchSize) });
  }
  const tokensByBatch = new Array(batches.length).fill(0);

  let idx = 0;
  async function workerLoop() {
    while (idx < batches.length) {
      const cur = idx++;
      const { start, batch } = batches[cur];

      const emb = await embedWithRetry(openai, {
        model,
        inputs: batch,
        maxRetries,
        tenantId,
        expectedDim,
        signal
      });

      const gotCount = Array.isArray(emb?.data) ? emb.data.length : 0;
      const wantCount = batch.length;
      const firstLen = Array.isArray(emb?.data?.[0]?.embedding)
        ? emb.data[0].embedding.length
        : null;
      const responseModel = typeof emb?.model === "string" ? emb.model : null;

      // Defense: fail immediately if response count/dimensions mismatch (to prevent mixing or missing data later).
      if (gotCount !== wantCount) {
        const err = new Error(
          `Embedding batch size mismatch: expected_count=${wantCount}, got_count=${gotCount}`
        );
        err.status = 400;
        console.error("embedding_batch_size_mismatch", {
          tenant: tenantId || "empty",
          model,
          response_model: responseModel,
          from: start,
          to: Math.min(texts.length, start + batch.length),
          expected_count: wantCount,
          got_count: gotCount,
          first_embedding_len: firstLen
        });
        throw err;
      }
      if (expectedDim && firstLen && firstLen !== expectedDim) {
        const err = new Error(
          `Invalid embedding vector dimension from provider: expected=${expectedDim}, got=${firstLen}`
        );
        err.status = 400;
        console.error("embedding_dim_mismatch_from_provider", {
          tenant: tenantId || "empty",
          model,
          response_model: responseModel,
          from: start,
          to: Math.min(texts.length, start + batch.length),
          expected_dim: expectedDim,
          got_dim: firstLen
        });
        throw err;
      }

      // Track token usage (use usage field if present, otherwise estimate based on text length).
      let tokensThisBatch = 0;
      if (emb.usage?.total_tokens) {
        tokensThisBatch = emb.usage.total_tokens;
      } else {
        const estimatedTokens = batch.reduce((sum, text) => {
          return sum + Math.ceil((text?.length || 0) / 4);
        }, 0);
        tokensThisBatch = estimatedTokens;
      }
      tokensByBatch[cur] = tokensThisBatch;

      // Preserve order: fill starting from the start index.
      for (let j = 0; j < emb.data.length; j++) {
        const vec = emb.data[j]?.embedding;
        const len = Array.isArray(vec) ? vec.length : null;
        if (expectedDim && len !== expectedDim) {
          const err = new Error(
            `Invalid embedding vector dimension: expected=${expectedDim}, got=${len || "null"}`
          );
          err.status = 400;
          console.error("embedding_vector_dim_invalid", {
            tenant: tenantId || "empty",
            model,
            batch_from: start,
            batch_to: Math.min(texts.length, start + batch.length),
            idx: start + j,
            expected_dim: expectedDim,
            got_dim: len
          });
          throw err;
        }
        vectors[start + j] = vec;
      }

      console.log("embedded_batch", {
        tenant: tenantId || "empty",
        from: start,
        to: Math.min(texts.length, start + batch.length),
        tokens_this_batch: emb.usage?.total_tokens || null
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
  totalTokens = tokensByBatch.reduce((a, b) => a + (b || 0), 0);

  return { vectors, totalTokens };
}

// ============================================================================
// Main function.
// ============================================================================

/**
 * Main processing function.
 * Download JSONL file from GCS, convert texts to embedding vectors,
 * and store them in Qdrant, running the full workflow.
 *
 * Processing steps:
 * 1. Read settings from environment variables.
 * 2. Download JSONL file from GCS.
 * 3. Parse JSONL (extract row_id, text, version).
 * 4. Convert texts to embedding vectors (batch processing).
 * 5. Check or create Qdrant collection
 * 6. Retrieve existing row_id and classify as add/update/delete (incremental)
 * 7. Delete removed rows and upsert new/changed rows
 *
 * Required environment variables:
 * - TENANT: Tenant ID
 * - DATASET: Dataset ID
 * - GCS_PATH: GCS file path (for actual work: only toAdd, newly added rows only)
 * - OPENAI_API_KEY: OpenAI API key
 * - QDRANT_URL: Qdrant server URL
 *
 * Optional environment variables (with defaults):
 * - EMBED_MODEL: Embedding model (default: "text-embedding-3-small")
 * - VECTOR_SIZE: Vector dimension (default: 1536, text-embedding-3-small)
 *
 * Optional environment variables:
 * - FULL_GCS_PATH: Full GCS file path (for deletion check: full newRows, used if present)
 *   → If absent, GCS_PATH is also used for deletion check (backward compatibility)
 *
 * Optional environment variables:
 * - JOB_ID: Job ID (default: "local")
 * - QDRANT_COLLECTION_BASE: Base collection name (default: "cm_chunks")
 * - EMBED_BATCH: Batch size (default: 64)
 * - EMBED_MAX_RETRIES: Max retry count (default: 5)
 *
 * Note: MAX_ROWS and MAX_TEXT_CHARS are already checked in uploadDataset.js
 * They are not checked in worker.js
 */
// ============================================================================
// Timeout detection and cleanup function
// ============================================================================

/**
 * Update dataset status to FAILED and perform cleanup
 * @param {string} tenant - Tenant ID
 * @param {string} datasetId - Dataset ID
 * @param {string} reason - Failure reason
 */
async function updateStatusToFailedAndCleanup(
  tenant,
  datasetId,
  reason,
  datasetLocale,
  jobId
) {
  if (getApps().length === 0) {
    initializeApp();
  }
  const db = getFirestore();

  const datasetRef = db
    .collection("tenants")
    .doc(tenant)
    .collection("datasets")
    .doc(datasetId);

  const locale = normalizeWorkerLocale(datasetLocale);
  const errorForUser = getWorkerLocalizedDatasetError(
    reason != null ? String(reason) : "",
    locale
  );

  let statusUpdated = false;
  await db.runTransaction(async (transaction) => {
    statusUpdated = false;
    const snapshot = await transaction.get(datasetRef);
    if (
      jobId &&
      snapshot.exists &&
      snapshot.data()?.processing_job_id !== jobId
    ) {
      return;
    }
    transaction.set(
      datasetRef,
      {
        status: DatasetStatus.FAILED,
        processing_job_id: FieldValue.delete(),
        updated_at: Date.now(),
        error: errorForUser
      },
      { merge: true }
    );
    statusUpdated = true;
  });

  console.log("dataset_status_updated_to_failed", {
    tenant,
    dataset_id: datasetId,
    reason,
    error_localized: errorForUser,
    dataset_locale: locale,
    job_id: jobId || null,
    status_updated: statusUpdated,
    message: statusUpdated
      ? "Dataset status updated to failed"
      : "Dataset failure update safely skipped because job ownership changed"
  });
  return { handled: true, statusUpdated };
}

class IngestExecutionError extends Error {
  constructor(message, { cause, retryable = false, statusHandled = false, code = "INGEST_FAILED" } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "IngestExecutionError";
    this.retryable = retryable;
    this.statusHandled = statusHandled;
    this.code = code;
  }
}

function createInvocationLifecycle({ tenant, datasetId, datasetLocale, jobId }) {
  const startedAt = Date.now();
  const WARNING_TIME_MS = 18 * 60 * 1000;
  const TERMINATION_TIME_MS = 18.5 * 60 * 1000;
  let terminating = false;
  let terminationError = null;
  let warningTimer = null;
  let timeoutTimer = null;
  const abortController = new AbortController();

  warningTimer = setTimeout(() => {
    if (terminating) return;
    const elapsed = Date.now() - startedAt;
    console.warn("timeout_warning", {
      tenant,
      dataset_id: datasetId,
      elapsed_ms: elapsed,
      elapsed_minutes: Math.round(elapsed / 60000),
      remaining_seconds: Math.round((TERMINATION_TIME_MS - elapsed) / 1000),
      message: "Timeout warning: Termination will occur in 30 seconds"
    });
  }, WARNING_TIME_MS);

  timeoutTimer = setTimeout(() => {
    if (terminating) return;
    terminating = true;
    const elapsed = Date.now() - startedAt;
    const reason = `Job timeout: Execution exceeded ${Math.round(elapsed / 60000)} minutes. The job is being terminated to prevent Cloud Functions timeout.`;
    console.warn("timeout_termination", {
      tenant,
      dataset_id: datasetId,
      elapsed_ms: elapsed,
      elapsed_minutes: Math.round(elapsed / 60000),
      message: "Timeout reached, aborting in-flight work before responding"
    });
    terminationError = new IngestExecutionError(reason, {
      retryable: false,
      statusHandled: false,
      code: "INGEST_TIMEOUT"
    });
    abortController.abort(terminationError);
    captureError(terminationError, {
      tenant_id: tenant || "empty",
      function_name: "runIngest.timeout",
      extra: { dataset_id: datasetId, elapsed_ms: elapsed }
    });
  }, TERMINATION_TIME_MS);

  return {
    signal: abortController.signal,
    isTerminating: () => terminating,
    getTerminationError: () => terminationError,
    assertActive() {
      if (terminating) {
        throw terminationError;
      }
    },
    cleanup() {
      if (warningTimer) clearTimeout(warningTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      warningTimer = null;
      timeoutTimer = null;
    }
  };
}

async function executeIngest(options, lifecycle) {
  // ========================================================================
  // 1. Read and validate environment variables
  // ========================================================================

  const jobId = String(options?.jobId ?? "local").trim() || "local";
  const tenant = String(options?.tenant ?? "").trim();
  const datasetId = String(options?.datasetId ?? "default").trim();
  const gsPath = String(options?.gcsPath ?? "").trim();
  const fullGsPath = String(options?.fullGcsPath ?? "").trim();
  const qdrantUrl = String(options?.qdrantUrl ?? "").trim();
  const embedModel = String(options?.embedModel ?? "text-embedding-3-small").trim();
  const vectorSize = options?.vectorSize != null ? Number(options.vectorSize) : 1536;
  const datasetLocale = normalizeWorkerLocale(options?.datasetLocale);

  // Validate required environment variables
  if (!tenant) {
    const error = new Error("TENANT is required");
    console.error("missing_required_env", {
      tenant: tenant || "empty",
      dataset_id: datasetId,
      error: error.message,
      message: "TENANT option is missing or empty"
    });
    throw error;
  }
  if (!gsPath) {
    const error = new Error("GCS_PATH is required");
    console.error("missing_required_env", {
      tenant,
      dataset_id: datasetId,
      error: error.message,
      message: "GCS_PATH option is missing or empty"
    });
    throw error;
  }

  // ========================================================================
  // 1-1. Check and update dataset status (prevent concurrent execution)
  // ========================================================================
  // ✅ Improvement: Check if another job for the same dataset is running
  // Save job ID in Firestore to distinguish same or different jobs
  let previousEmbedValue = null;
  let previousEmbedValueCount = null;
  let previousEmbedValueBasis = null;
  let rebuildEmbedValueFromQdrant = false;
  try {
    if (getApps().length === 0) {
      initializeApp();
    }
    const db = getFirestore();

    const datasetRef = db
      .collection("tenants")
      .doc(tenant)
      .collection("datasets")
      .doc(datasetId);

    // Unique ID of the current job (should be the same on retries)
    // - Cloud Run Job retries should be treated as "same execution" and continue
    // - Use JOB_ID injected by uploadDataset.js if present
    // - Otherwise, use Cloud Run default env if possible (fallback to local if none)
    const currentJobId = jobId;

    // Update dataset status to INDEXING (atomic with transaction)
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(datasetRef);
      const docData = doc.exists ? doc.data() : {};
      const docStatus = docData?.status;
      const docProcessingJobId = docData?.processing_job_id;
      const docLastUpdated = docData?.updated_at;
      rebuildEmbedValueFromQdrant =
        docStatus === DatasetStatus.INDEXING && docProcessingJobId === currentJobId;
      previousEmbedValueBasis = docData?.embed_value_basis;
      previousEmbedValue = Array.isArray(docData?.embed_value)
        ? docData.embed_value
        : null;
      previousEmbedValueCount =
        typeof docData?.embed_value_count === "number"
          ? docData.embed_value_count
          : null;

      const isActiveStatus =
        docStatus === DatasetStatus.PROCESSING ||
        docStatus === DatasetStatus.INDEXING;

      // If status is PROCESSING/INDEXING and recently updated (within 30 minutes)
      if (isActiveStatus && docLastUpdated) {
        // updated_at type compatibility: Timestamp object or number (milliseconds)
        const lastUpdatedTime = normalizeTimestamp(docLastUpdated);
        const now = Date.now();
        const timeSinceUpdate = now - lastUpdatedTime;
        const MAX_INDEXING_TIME_MS = 30 * 60 * 1000; // 30 minutes

        if (timeSinceUpdate < MAX_INDEXING_TIME_MS) {
          // Check if another job is running (compare processing_job_id)
          // - If processing_job_id equals currentJobId, treat as "retry/restart of same execution" and proceed
          if (docProcessingJobId && docProcessingJobId !== currentJobId) {
            // Another job is running
            throw new Error(
              `Another indexing job (${docProcessingJobId}) is already running for dataset ${datasetId}. ` +
              `Current job ID: ${currentJobId}. Please wait for it to complete or check the dataset status.`
            );
          } else if (!docProcessingJobId) {
            // If processing_job_id is missing, it may have been run by an older version of the code.
            // Fail safely.
            throw new Error(
              `Dataset ${datasetId} is in ${docStatus} status but processing_job_id is missing. ` +
              `This may indicate a stuck job. Please check the dataset status manually.`
            );
          }
          // When docProcessingJobId === currentJobId, it means the same job is retrying.
          // In this case, continue (update status).
        } else {
          // If more than 30 minutes have passed, the previous job is likely stuck (timeout or failure).
          // Force update the status and continue.
          console.warn("dataset_indexing_timeout", {
            tenant,
            dataset_id: datasetId,
            previous_job_id: docProcessingJobId,
            current_job_id: currentJobId,
            time_since_update_ms: timeSinceUpdate,
            message:
              "Previous indexing job may have timed out, proceeding with new job"
          });
        }
      }

      // Update status (including processing_job_id).
      transaction.set(
        datasetRef,
        {
          status: DatasetStatus.INDEXING,
          processing_job_id: currentJobId, // Save the current job ID.
          updated_at: Date.now()
        },
        { merge: true }
      );
    });

    console.log("dataset_status_updated", {
      tenant,
      dataset_id: datasetId,
      job_id: currentJobId,
      status: DatasetStatus.INDEXING,
      message: "Dataset status updated to indexing"
    });

    // ========================================================================
    // Detect timeout and set signal handler.
    // ========================================================================
    // After 18 minutes 30 seconds, update status to FAILED and force exit immediately.
    // Perform cleanup before Cloud Run forcibly terminates.
  } catch (statusUpdateError) {
    // Stop the job if status update fails (to prevent concurrent runs).
    const errorMessage =
      statusUpdateError?.message || String(statusUpdateError);
    if (
      errorMessage.includes("already running") ||
      errorMessage.includes("stuck job")
    ) {
      // Stop the job if another job is running.
      // ⚠️ Important: This case is not a "failure" but "preventing duplicate runs."
      // Do not set dataset status to FAILED. (There is a valid job running concurrently.)
      console.warn("dataset_concurrent_indexing_detected", {
        tenant,
        dataset_id: datasetId,
        error: errorMessage
      });
      // Apply cooldown in Sentry to reduce noise (duplicate calls may occasionally happen in production).
      captureErrorThrottled(
        statusUpdateError,
        {
          tenant_id: tenant || "empty",
          function_name: "main",
          extra: {
            dataset_id: datasetId,
            operation: "concurrent_indexing_check",
            message: "Concurrent indexing detected; worker aborted without changing status",
            severity: "warning"
          }
        },
        { key: `concurrent_indexing:${tenant}:${datasetId}`, cooldownMs: 60_000, sampleRate: 0.2 }
      );

      return {
        outcome: "skipped_concurrent",
        skipped: true,
        retryable: false,
        tenant,
        datasetId,
        jobId,
        reason: errorMessage
      };
    } else {
      // For other errors, log them and rethrow to be handled in main().catch().
      // If initialization fails, status update is impossible, so handle it in main().catch().
      console.error("dataset_status_update_failed", {
        tenant,
        dataset_id: datasetId,
        error: errorMessage,
        stack: statusUpdateError?.stack,
        message: "Dataset status update failed at initialization. Will be handled by main().catch()"
      });
      // Send error to Sentry.
      captureError(statusUpdateError, {
        tenant_id: tenant || "empty",
        function_name: "main",
        extra: {
          dataset_id: datasetId,
          operation: "dataset_status_update",
          message: "Dataset status update failed at job start"
        }
      });
      // Rethrow error to be handled in main().catch().
      // This ensures status updates and logging are handled consistently in main().catch().
      throw statusUpdateError;
    }
  }

  // Create collection name.
  // Format: {base}__{tenant}.
  // Example: base="cm_chunks", tenant="hadfamily" → "cm_chunks__hadfamily".
  const baseCollection = (
    process.env.QDRANT_COLLECTION_BASE ?? "cm_chunks"
  ).trim();
  const collection = `${baseCollection}__${toSafeCollectionName(tenant)}`;

  // Optional environment variable (uses default if missing).
  const embedBatch = Number(process.env.EMBED_BATCH ?? "64"); // Batch size.
  const embedMaxRetries = Number(process.env.EMBED_MAX_RETRIES ?? "5"); // Maximum retry count.

  // Note: MAX_ROWS and MAX_TEXT_CHARS are already checked in uploadDataset.js
  // worker.js does not receive or check environment variables.

  // Versioning is done only per row (remove versions collection per dataset)

  // Validate required environment variables
  if (!tenant) throw new Error("TENANT is required");
  if (!datasetId) throw new Error("DATASET is required");
  if (!gsPath) throw new Error("GCS_PATH is required (JSONL 권장)");
  if (!process.env.OPENAI_API_KEY)
    throw new Error("OPENAI_API_KEY is required");
  // embedModel has a default value, so no check needed.

  // If FULL_GCS_PATH exists, use it for deletion tracking; otherwise, use GCS_PATH for backward compatibility.
  const deleteDetectionGsPath = fullGsPath || gsPath;

  // QDRANT_URL is supplied per invocation.
  if (!qdrantUrl) {
    throw new Error("QDRANT_URL is required");
  }

  // Create Qdrant client (pass tenantId to include in error logs).
  const qdrant = makeQdrantClient(qdrantUrl, tenant, lifecycle.signal);

  const jobStartedAt = Date.now();

  // Start log.
  let openaiBaseUrlSource = null;
  let openaiBaseUrlRaw = null;
  for (const [k, v] of [
    ["OPENAI_BASE_URL", process.env.OPENAI_BASE_URL],
    ["OPENAI_API_BASE", process.env.OPENAI_API_BASE],
    ["OPENAI_ENDPOINT", process.env.OPENAI_ENDPOINT],
    ["OPENAI_HOST", process.env.OPENAI_HOST]
  ]) {
    if (v && String(v).trim()) {
      openaiBaseUrlSource = k;
      openaiBaseUrlRaw = String(v);
      break;
    }
  }
  const openaiBaseUrl = sanitizeUrlForLog(openaiBaseUrlRaw);

  console.log("start", {
    node_version: process.version,
    jobId,
    tenant,
    dataset_id: datasetId,
    gs_path: gsPath, // For actual work
    full_gcs_path: fullGsPath || null, // For deletion tracking (use if available).
    collection,
    embedModel,
    vectorSize,
    embedBatch,
    embedMaxRetries,
    qdrantUrl,
    openai_base_url: openaiBaseUrl,
    openai_base_url_source: openaiBaseUrlSource
  });

  // ========================================================================
  // 2. Download JSONL file from GCS.
  // ========================================================================
  // 2-1. Download actual work JSONL (GCS_PATH: only toAdd, newly added rows).
  // 2-2. Download deletion tracking JSONL (FULL_GCS_PATH: all newRows, use if available).

  // GCS reuses the common firebase.js client from Functions.

  // ========================================================================
  // 3. Parse JSONL.
  // ========================================================================
  // 3-1. Parse actual work JSONL (GCS_PATH: only toAdd, newly added rows).
  // 3-2. Parse deletion tracking JSONL (FULL_GCS_PATH: all newRows, use if available).

  // Parse actual work JSONL (streaming).
  const rows = await readJsonlRowsFromGcs(storage, gsPath, tenant, datasetId);
  lifecycle.assertActive();
  console.log("worker_rows_count", rows.length); // Number of rows for actual work

  // Parse JSONL for deletion detection (use if available)
  let allNewRowIds = new Set(rows.map((r) => r.rowId)); // Default: row_id from worker JSONL
  let fullRowsCountForMetadata = null; // Total rows count (used when saving jsonl_paths)
  if (fullGsPath && fullGsPath !== gsPath) {
    const fullParsed = await readJsonlRowIdsAndCountFromGcs(
      storage,
      fullGsPath,
      tenant,
      datasetId
    );
    allNewRowIds = fullParsed.rowIds; // row_id of all newRows
    fullRowsCountForMetadata = fullParsed.rowsCount;
    console.log("full_rows_count", fullRowsCountForMetadata); // Total number of rows
  }

  // ========================================================================
  // 3.5. Check/create Qdrant collection (create if missing)
  // ========================================================================
  // For new tenant/dataset, collection doesn't exist, so create it before scrolling.
  // Create if missing, otherwise verify vector size only.
  await qdrant.ensureCollection(collection, vectorSize);
  lifecycle.assertActive();

  // ========================================================================
  // 4. Query and compare/classify existing row_id
  // ========================================================================
  // Query existing row_id from Qdrant (manage per row, remove docId filter)
  const existingRowIdsFromQdrant = await qdrant.getExistingRowIdsFromQdrant(
    collection,
    {
      tenant,
      dataset: datasetId
    }
  );

  lifecycle.assertActive();
  console.log("existing_row_ids_from_qdrant", existingRowIdsFromQdrant.size);

  // Mixed baseline average from previous version is read once in the next successful job for correction.
  if (existingRowIdsFromQdrant.size > 0 && previousEmbedValueBasis !== EMBED_VALUE_BASIS) {
    rebuildEmbedValueFromQdrant = true;
  }

  if (
    rows.length === 0 &&
    allNewRowIds.size === 0 &&
    existingRowIdsFromQdrant.size === 0 &&
    !rebuildEmbedValueFromQdrant
  ) {
    throw new Error(
      "No valid rows found in worker JSONL and no existing dataset rows to delete."
    );
  }

  // For actual work: include all rows from GCS_PATH in toAdd (only toAdd)
  // - New rows: not in Qdrant, so generate embeddings and upsert
  // Note: rowId is based on column values, so if column values change, rowId changes and is treated as a new row
  const toAdd = [];
  for (const newRow of rows) {
    toAdd.push(newRow);
  }

  // Count new and changed rows (for logging)
  const newRowsCount = toAdd.filter(
    (row) => !existingRowIdsFromQdrant.has(row.rowId)
  ).length;
  // Defensive programming: newRowsCount cannot exceed toAdd.length but add safeguard
  const updatedRowsCount = Math.max(0, toAdd.length - newRowsCount);

  // Deletion detection: row_id not in all newRows (FULL_GCS_PATH or GCS_PATH) are deletion targets
  const toArchive = [];
  for (const rowId of existingRowIdsFromQdrant) {
    if (!allNewRowIds.has(rowId)) {
      toArchive.push({ rowId });
    }
  }

  // Incremental omission diagnosis: rows in full JSONL but missing in Qdrant and worker upsert targets
  // → Cannot recover in this job (limitation of GCS-only diff)
  const workerRowIdSet = new Set(toAdd.map((row) => row.rowId));
  const missingInQdrantNotHealed = [];
  for (const rowId of allNewRowIds) {
    if (!existingRowIdsFromQdrant.has(rowId) && !workerRowIdSet.has(rowId)) {
      missingInQdrantNotHealed.push(rowId);
    }
  }

  console.log("rows_classified", {
    worker_rows: rows.length,
    to_add: toAdd.length,
    to_archive: toArchive.length,
    new_rows: newRowsCount,
    updated_rows: updatedRowsCount,
    note: "변경된 row만 임베딩 생성 및 upsert (비용 절감)"
  });

  if (missingInQdrantNotHealed.length > 0) {
    const fullRowsCount =
      fullRowsCountForMetadata != null
        ? fullRowsCountForMetadata
        : allNewRowIds.size;
    const projectedQdrantAfter =
      existingRowIdsFromQdrant.size - toArchive.length + newRowsCount;
    const sampleRowIds = (ids, limit = 20) =>
      (Array.isArray(ids) ? ids : Array.from(ids)).slice(0, limit);
    const sentryKey = `ingest_integrity_gap:${tenant}:${datasetId}`;
    if (shouldSendSentry({ key: sentryKey, cooldownMs: 5 * 60 * 1000 })) {
      captureMessage(
        "ingest_integrity_gap: full JSONL rows missing from Qdrant and not in worker upsert set",
        "warning",
        {
          tenant_id: tenant || "empty",
          function_name: "ingestWorker",
          tags: {
            alert_code: "ingest_integrity_gap",
            dataset_id: datasetId,
            collection,
            job_id: jobId
          },
          fingerprint: ["ingest_integrity_gap", tenant || "empty", datasetId],
          extra: {
            alert_code: "ingest_integrity_gap",
            job_id: jobId,
            dataset_id: datasetId,
            collection,
            full_rows: fullRowsCount,
            qdrant_before: existingRowIdsFromQdrant.size,
            worker_rows: rows.length,
            to_add: toAdd.length,
            to_archive: toArchive.length,
            new_rows: newRowsCount,
            updated_rows: updatedRowsCount,
            missing_in_qdrant_not_healed: missingInQdrantNotHealed.length,
            projected_qdrant_after: projectedQdrantAfter,
            full_vs_qdrant_gap_before: Math.max(
              0,
              fullRowsCount - existingRowIdsFromQdrant.size
            ),
            sample_missing_row_ids: sampleRowIds(missingInQdrantNotHealed),
            sample_to_add_row_ids: sampleRowIds(toAdd.map((row) => row.rowId)),
            sample_to_archive_row_ids: sampleRowIds(
              toArchive.map((row) => row.rowId)
            ),
            gcs_path: gsPath || null,
            full_gcs_path: fullGsPath || null,
            risk:
              "Incremental ingest cannot restore these points; force reindex or full worker JSONL required"
          }
        }
      );
      // Flush to prevent event loss even on success path
      await flushSentry();
    }
  }

  // ========================================================================
  // 5. Embedding generation (only for changed rows: new + changed rows)
  // ========================================================================
  // ✅ Important: generate embeddings only for new rows and upsert (cost saving)
  // - New rows: generate embeddings and upsert
  // Note: rowId is based on column values, so if column values change, rowId changes and is treated as a new row
  const rowsToEmbed = toAdd; // Only new rows
  const embeddingData = rowsToEmbed.map((r) => buildEmbeddingDataFromRowText(r.text));
  const embeddingTexts = embeddingData.map((d) => d.embeddingText);
  // Fallback to original text if embedding input is empty
  const texts = embeddingTexts.map((t, i) =>
    t && t.length > 0 ? t : (rowsToEmbed[i]?.text || "")
  );

  let vectors = [];
  let totalTokens = 0;

  if (texts.length > 0) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const embeddingResult = await embedInBatches(
      openai,
      {
        model: embedModel,
        texts,
        batchSize: embedBatch,
        maxRetries: embedMaxRetries,
        expectedDim: vectorSize,
        signal: lifecycle.signal
      },
      tenant
    );

    lifecycle.assertActive();
    vectors = embeddingResult.vectors.map(toStoredCosineVector);
    totalTokens = embeddingResult.totalTokens;
  }

  // Verify vector size (check if matches vectorSize from environment variable)
  const actualVectorSize = vectors.length > 0 ? vectors[0]?.length : null;
  if (rowsToEmbed.length > 0 && !actualVectorSize) {
    throw new Error("embedding failed");
  }
  if (actualVectorSize) {
    console.log("embedding_dim", actualVectorSize);
    // Example: "text-embedding-3-small" → 1536 dimensions

    // Verify that vectorSize from environment matches actual embedding dimension
    if (actualVectorSize !== vectorSize) {
      throw new Error(
        `Vector size mismatch: expected=${vectorSize} (from VECTOR_SIZE env), actual=${actualVectorSize} (from embedding result). ` +
        `Please check VECTOR_SIZE environment variable.`
      );
    }
  }

  console.log("embedding_tokens_used", {
    total_tokens: totalTokens,
    rows_embedded: rowsToEmbed.length
  });

  // ========================================================================
  // 5.5. Update token usage (embedding tokens) — prevent loss even if Qdrant upsert fails
  // ========================================================================
  // Previously, token usage was updated after Qdrant operation,
  // so if embedding call succeeded but Qdrant upsert failed, usage could be lost.
  // (e.g., vector dimension mismatch, Qdrant 4xx/5xx errors)
  // → If embedding succeeded and totalTokens calculated, accumulate immediately.
  if (totalTokens > 0 && tenant) {
    try {
      lifecycle.assertActive();
      // Initialize Firestore Admin SDK (reuse if already initialized)
      if (getApps().length === 0) {
        initializeApp();
      }
      const db = getFirestore();

      const now = new Date();
      const timestamp = now.getTime();

      // Generate date info (usage_daily / daily mail and console Analytics use UTC)
      const year = now.getUTCFullYear();
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");
      const day = String(now.getUTCDate()).padStart(2, "0");
      const dateKey = `${year}-${month}-${day}`;
      const monthKey = `${year}-${month}`;
      const tokenLedgerId = crypto
        .createHash("sha256")
        .update(jobId)
        .digest("hex");
      let tokenUsageApplied = false;

      await db.runTransaction(async (transaction) => {
        lifecycle.assertActive();
        tokenUsageApplied = false;
        const docRef = db.collection("tenants").doc(tenant);
        const docSnap = await transaction.get(docRef);
        if (!docSnap.exists) {
          throw new Error(`Tenant not found during token accounting: ${tenant}`);
        }

        const data = docSnap.data();
        const billing = data?.billing || {};
        const usage = data?.usage || {};
        const quota = data?.quota || {};

        const startDay = billing?.startDay != null ? billing.startDay : now.getDate();
        let existingWindowStartAt = billing?.windowStartAt ? new Date(billing.windowStartAt) : null;
        let existingWindowEndAt = billing?.windowEndAt ? new Date(billing.windowEndAt) : null;

        let windowStartAt = existingWindowStartAt;
        let windowEndAt = existingWindowEndAt;
        let shouldResetBillingMonth = false;

        if (existingWindowEndAt && isBillingWindowExpired(existingWindowEndAt, now)) {
          const newWindow = calculateBillingWindow(now, startDay, existingWindowStartAt);
          windowStartAt = newWindow.windowStartAt;
          windowEndAt = newWindow.windowEndAt;
          shouldResetBillingMonth = true;
        } else if (!existingWindowStartAt || !existingWindowEndAt) {
          const newWindow = calculateBillingWindow(now, startDay, null);
          windowStartAt = newWindow.windowStartAt;
          windowEndAt = newWindow.windowEndAt;
        }

        const billingKey = generateBillingKey(windowStartAt, windowEndAt);

        const dailyRef = db
          .collection("tenants")
          .doc(tenant)
          .collection("usage_daily")
          .doc(dateKey);
        const monthlyRef = db
          .collection("tenants")
          .doc(tenant)
          .collection("usage_monthly")
          .doc(monthKey);
        const billingRef = db
          .collection("tenants")
          .doc(tenant)
          .collection("usage_billing")
          .doc(billingKey);
        const tokenLedgerRef = db
          .collection("tenants")
          .doc(tenant)
          .collection("ingest_token_usage_ledger")
          .doc(tokenLedgerId);
        const [dailySnap, monthlySnap, billingSnap, tokenLedgerSnap] =
          await Promise.all([
            transaction.get(dailyRef),
            transaction.get(monthlyRef),
            transaction.get(billingRef),
            transaction.get(tokenLedgerRef)
          ]);

        if (tokenLedgerSnap.exists && tokenLedgerSnap.data()?.applied === true) {
          tokenUsageApplied = false;
          return;
        }

        const baseTokenLimit = quota.token_limit_month || Infinity;
        const currentTokenUsedBillingMonth = shouldResetBillingMonth
          ? 0
          : usage.token_used_billing_month || 0;

        let usedFromBasePlan = 0;
        let remainingForAddon = totalTokens;
        if (baseTokenLimit !== Infinity) {
          const availableInBasePlan = Math.max(0, baseTokenLimit - currentTokenUsedBillingMonth);
          usedFromBasePlan = Math.max(0, Math.min(totalTokens, availableInBasePlan));
          remainingForAddon = Math.max(0, totalTokens - usedFromBasePlan);
        } else {
          usedFromBasePlan = totalTokens;
          remainingForAddon = 0;
        }

        let addonTokenArray = Array.isArray(data?.addon_token) ? data.addon_token : [];
        let updatedAddonTokenArray = processAddonStatus(addonTokenArray, timestamp);

        let usedFromAddon = 0;
        if (remainingForAddon > 0) {
          const addonResult = consumeAddonTokens(updatedAddonTokenArray, remainingForAddon, timestamp);
          usedFromAddon = addonResult.usedFromAddon;
          updatedAddonTokenArray = addonResult.updated;
        }
        if (!Array.isArray(updatedAddonTokenArray)) updatedAddonTokenArray = [];

        const lastUpdatedDate = usage?.lastUpdatedDate;
        const lastUpdatedMonth = usage?.lastUpdatedMonth;
        const shouldResetToday = lastUpdatedDate && lastUpdatedDate !== dateKey;
        const shouldResetMonth = lastUpdatedMonth && lastUpdatedMonth !== monthKey;

        const updateData = {
          usage: {
            lastUpdatedDate: dateKey,
            lastUpdatedMonth: monthKey
          },
          billing: {
            ...billing,
            startDay: billing?.startDay != null ? billing.startDay : startDay,
            windowStartAt: windowStartAt.getTime(),
            windowEndAt: windowEndAt.getTime()
          },
          addon_token: updatedAddonTokenArray
        };

        updateData.usage.token_used_today = shouldResetToday
          ? totalTokens
          : FieldValue.increment(totalTokens);
        updateData.usage.token_used_month = shouldResetMonth
          ? totalTokens
          : FieldValue.increment(totalTokens);

        const safeUsedFromBasePlan = Math.max(0, usedFromBasePlan);
        if (shouldResetBillingMonth) {
          updateData.usage.token_used_billing_month = safeUsedFromBasePlan;
        } else if (safeUsedFromBasePlan > 0) {
          updateData.usage.token_used_billing_month = FieldValue.increment(safeUsedFromBasePlan);
        }
        if (usedFromAddon > 0) {
          const currentAddonUsed = usage.token_used_addon_token || 0;
          updateData.usage.token_used_addon_token = currentAddonUsed + usedFromAddon;
        }

        transaction.set(docRef, updateData, { merge: true });

        const dailyPayload = {
          date_key: dateKey,
          month_key: monthKey,
          tenant_id: tenant,
          tokens: { total: FieldValue.increment(totalTokens) },
          updated_at: timestamp
        };
        if (!dailySnap.exists) dailyPayload.created_at = timestamp;
        transaction.set(dailyRef, dailyPayload, { merge: true });

        const monthlyPayload = {
          month_key: monthKey,
          tokens: { total: FieldValue.increment(totalTokens) },
          tenant_id: tenant,
          updated_at: timestamp
        };
        if (!monthlySnap.exists) monthlyPayload.created_at = timestamp;
        transaction.set(monthlyRef, monthlyPayload, { merge: true });

        const totalUsageForBilling = safeUsedFromBasePlan + usedFromAddon;
        const billingPayload = {
          billingKey,
          tokens: { total: FieldValue.increment(totalUsageForBilling) },
          windowStart: formatDateString(windowStartAt),
          windowEnd: formatDateString(windowEndAt),
          tenant_id: tenant,
          updated_at: timestamp
        };
        if (!billingSnap.exists) billingPayload.created_at = timestamp;
        transaction.set(billingRef, billingPayload, { merge: true });

        // Monthly audit (audit_monthly) — aggregate embedding tokens by model/purpose
        const auditRef = db
          .collection("tenants")
          .doc(tenant)
          .collection("audit_monthly")
          .doc(monthKey);
        const auditModelKey = (embedModel || "unknown").replace(/[.-]/g, "_");
        const auditPurpose = "embedding";
        transaction.set(
          auditRef,
          {
            month_key: monthKey,
            updated_at: timestamp,
            [`by_model.${auditModelKey}.input_tokens`]: FieldValue.increment(totalTokens),
            [`by_model.${auditModelKey}.output_tokens`]: FieldValue.increment(0),
            [`by_purpose.${auditPurpose}.input_tokens`]: FieldValue.increment(totalTokens),
            [`by_purpose.${auditPurpose}.output_tokens`]: FieldValue.increment(0)
          },
          { merge: true }
        );

        // Record job ledger and all usage increments in the same transaction to guarantee exactly-once.
        // expires_at can set Firestore TTL policy (e.g., 90 days). This collection is for queries.
        // Not for queries, so exclude unnecessary collection-group indexes like applied/job_id to reduce cost.
        transaction.create(tokenLedgerRef, {
          applied: true,
          job_id: jobId,
          job_id_hash: tokenLedgerId,
          tenant_id: tenant,
          dataset_id: datasetId,
          embed_model: embedModel,
          total_tokens: totalTokens,
          billing_key: billingKey,
          applied_at: timestamp,
          expires_at: new Date(timestamp + 90 * 24 * 60 * 60 * 1000)
        });
        tokenUsageApplied = true;
      });
      lifecycle.assertActive();

      console.log(
        tokenUsageApplied
          ? "token_usage_updated"
          : "token_usage_already_applied",
        {
          tenant,
          dataset_id: datasetId,
          job_id: jobId,
          total_tokens: totalTokens
        }
      );
    } catch (tokenUpdateError) {
      console.error("token_usage_update_failed", {
        tenant,
        error: tokenUpdateError?.message || String(tokenUpdateError),
        stack: tokenUpdateError?.stack
      });
      captureError(tokenUpdateError, {
        tenant_id: tenant || "empty",
        function_name: "main",
        extra: { stage: "token_usage_after_embedding" }
      });
      throw new IngestExecutionError("Token usage accounting failed", {
        cause:
          tokenUpdateError instanceof Error
            ? tokenUpdateError
            : new Error(String(tokenUpdateError)),
        retryable: true,
        code: "TOKEN_USAGE_ACCOUNTING_FAILED"
      });
    }
  }

  // ========================================================================
  // 6. Prepare points and upsert (only new rows: rowId is based on column values, so changes result in a new rowId).
  // ========================================================================
  // Create an array of points to upsert to Qdrant for only changed rows.
  // Each point includes an ID, vector, and metadata (payload).
  //
  // Generate point ID:
  // - row.rowId already contains a hash of tenant|datasetId|content,
  //   so convert row.rowId directly to UUID format without additional hashing.
  // - The same row.rowId always produces the same point ID (deterministic).
  //
  // ✅ Important: upsert only changed rows (cost saving).
  // - New rows: generate embeddings and upsert
  // - Changed rows: content changed, so generate embedding and upsert.

  const VECTOR_EMBEDDING = "embedding";
  const VECTOR_BM25 = "bm25";

  const points = rowsToEmbed.map((row, idx) => {
    const pointId = hexToUuid(row.rowId);
    const embeddingText = embeddingTexts[idx] || "";
    // Sparse/BM25 preserves raw row text as is.
    // It maintains lexical recall of schema-like key tokens.
    const bm25Input = row.text || embeddingText;
    const bm25 = textToBm25Sparse(bm25Input);
    return {
      id: pointId,
      vector: {
        [VECTOR_EMBEDDING]: vectors[idx],
        [VECTOR_BM25]: bm25.indices.length ? bm25 : { indices: [0], values: [0] }
      },
      payload: {
        tenant,
        dataset: datasetId,
        row_id: row.rowId,
        embed_model: embedModel,
        text: row.text,
        embedding_text: embeddingText,
        version: row.version || 1,
        row_kind_guess: row?.rowMeta?.row_kind_guess || "unknown",
        is_long_text: row?.rowMeta?.is_long_text === true,
        has_section_marker: row?.rowMeta?.has_section_marker === true,
        policy_like: row?.rowMeta?.policy_like === true,
        faq_like: row?.rowMeta?.faq_like === true
      }
    };
  });

  // ✅ Defensive: fully verify vector dimensions before batch upsert (to prevent contamination).
  // - Handle cases where embedding_dim is 1536 but upsert receives 384.
  if (points.length > 0) {
    const expectedDim = vectorSize;
    let badCount = 0;
    const badSamples = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const embVec = p?.vector?.[VECTOR_EMBEDDING];
      const len = Array.isArray(embVec) ? embVec.length : null;
      if (!len || len !== expectedDim) {
        badCount += 1;
        if (badSamples.length < 5) {
          badSamples.push({
            idx: i,
            row_id: p?.payload?.row_id || null,
            vector_meta: safePreviewArrayLengths(embVec)
          });
        }
      }
    }
    if (badCount > 0) {
      const err = new Error(
        `Invalid embedding vector dimension in points: expected=${expectedDim}, bad_count=${badCount}`
      );
      err.status = 400;
      console.error("invalid_embedding_vector_dimension", {
        tenant,
        dataset_id: datasetId,
        expected_dim: expectedDim,
        bad_count: badCount,
        bad_samples: badSamples
      });
      throw err;
    }
  }

  // Calculate average embedding per dataset (used for dataset selection during search, applied when over 100,000 entries).
  let embedValue = null;
  let embedValueCount = null;
  let embedValueInvalid = false;
  const getOldVectorsForMean = async (rowIds) => {
    try {
      const oldVectors = await qdrant.getEmbeddingVectorsByRowIds(collection, {
        tenant, dataset: datasetId, rowIds
      });
      if (rowIds.some(rowId => !oldVectors.has(rowId))) {
        throw new Error("Missing old vectors for dataset mean");
      }
      return oldVectors;
    } catch (error) {
      lifecycle.assertActive(); // Do not treat cancellations/timeouts as completed.
      embedValueInvalid = true;
      console.warn("embed_value_lookup_failed_skip", {
        tenant, dataset_id: datasetId, message: error?.message || String(error)
      });
      return new Map();
    }
  };
  if (!rebuildEmbedValueFromQdrant && (vectors.length > 0 || toArchive.length > 0)) {
    const dim = vectors.length > 0 ? vectors[0].length : vectorSize;
    const existingCountBefore = existingRowIdsFromQdrant.size;
    const maxOldVectorsFetch = Number(
      process.env.EMBED_VALUE_MAX_OLD_VECTORS_FETCH || "2000"
    );
    const sampleUpdatedSize = Number(
      process.env.EMBED_VALUE_SAMPLE_UPDATED || "400"
    );
    const sampleDeletedSize = Number(
      process.env.EMBED_VALUE_SAMPLE_DELETED || "400"
    );

    // For re-embedding IDs already in Qdrant, subtract the old vector and replace with the new vector.
    const newRowIds = [];
    const updatedRowIds = [];
    const newVecByRowId = new Map();
    const updatedVecByRowId = new Map();
    for (let i = 0; i < rowsToEmbed.length; i++) {
      const rid = rowsToEmbed[i].rowId;
      const vec = vectors[i];
      if (!rid || !vec) continue;
      if (existingRowIdsFromQdrant.has(rid)) {
        updatedRowIds.push(rid);
        updatedVecByRowId.set(rid, vec);
      } else {
        newRowIds.push(rid);
        newVecByRowId.set(rid, vec);
      }
    }
    const archiveRowIds = toArchive.map((a) => a.rowId).filter(Boolean);
    const needOldRowIds = Array.from(new Set([...updatedRowIds, ...archiveRowIds]));

    // Create sum based on previous average vector, then apply delta.
    let prevCount =
      previousEmbedValueCount != null ? previousEmbedValueCount : existingCountBefore;
    if (
      previousEmbedValueCount != null &&
      existingCountBefore > 0 &&
      Math.abs(previousEmbedValueCount - existingCountBefore) >
        Math.max(50, existingCountBefore * 0.05)
    ) {
      console.warn("embed_value_count_mismatch", {
        tenant,
        dataset_id: datasetId,
        previousEmbedValueCount,
        existingCountBefore,
        message: "Using existingCountBefore for embed_value update"
      });
      prevCount = existingCountBefore;
    }

    // Skip if previous embed_value is missing but existing data exists to avoid incorrect averages.
    if (!previousEmbedValue && existingCountBefore > 0) {
      console.warn("embed_value_missing_skip_update", {
        tenant,
        dataset_id: datasetId,
        existingCountBefore,
        message:
          "Previous embed_value missing; skipping embed_value update to avoid biased mean"
      });
    } else {
      const sum =
        previousEmbedValue && prevCount > 0
          ? scaleVector(previousEmbedValue, prevCount)
          : new Array(dim).fill(0);

      let oldVecMap = new Map();
      let approxMode = false;
      let approxSamples = { updated: 0, deleted: 0 };
      let approxCounts = {
        updated_total: updatedRowIds.length,
        deleted_total: archiveRowIds.length
      };

      const largeChangeStrategyRaw = String(
        process.env.EMBED_VALUE_LARGE_CHANGE_STRATEGY || "auto"
      ).toLowerCase(); // "auto" | "sample" | "skip"

      const existingCountSafe = Math.max(0, existingCountBefore || 0);
      const changeRatio =
        existingCountSafe > 0 ? needOldRowIds.length / existingCountSafe : 0;

      // Automatic strategy:
      // - Skip if old-vector query volume is too high (time/cost increase) or change rate is high (only update count).
      // - Otherwise, approximate update using sampling.
      // - Full query (exact) only performed if needOldRowIds <= maxOldVectorsFetch.
      const autoStrategy = (() => {
        if (needOldRowIds.length <= maxOldVectorsFetch) return "exact";
        if (existingCountSafe === 0) return "sample";
        if (needOldRowIds.length >= maxOldVectorsFetch * 3) return "skip";
        if (needOldRowIds.length >= 5000) return "skip";
        if (changeRatio >= 0.2) return "skip";
        if (archiveRowIds.length >= Math.max(500, existingCountSafe * 0.1)) return "skip";
        return "sample";
      })();

      const effectiveStrategy =
        largeChangeStrategyRaw === "auto"
          ? autoStrategy
          : largeChangeStrategyRaw === "skip"
            ? "skip"
            : "sample";

      if (needOldRowIds.length <= maxOldVectorsFetch) {
        oldVecMap = await getOldVectorsForMean(needOldRowIds);
      } else {
        if (effectiveStrategy === "skip") {
          console.warn("embed_value_large_change_skip", {
            tenant,
            dataset_id: datasetId,
            need_old_vectors: needOldRowIds.length,
            max_old_vectors_fetch: maxOldVectorsFetch,
            change_ratio: changeRatio,
            strategy_raw: largeChangeStrategyRaw,
            strategy_effective: effectiveStrategy,
            message:
              "Large change detected; skipping embed_value update (count will be updated)"
          });
          // embed_value is not updated; only count is stored.
          approxMode = true;
          approxCounts = {
            updated_total: updatedRowIds.length,
            deleted_total: archiveRowIds.length
          };
          // Reflecting only additions can cause bias → safely exit without changing sum.
          // finalCount may only be reflected as embedValueCount below.
        } else {
        // Large-scale changes: approximate update based on sampling (embed_value is for dataset selection, so approximation is acceptable).
        approxMode = true;
        const sampledUpdated = sampleArray(
          updatedRowIds,
          Math.min(sampleUpdatedSize, updatedRowIds.length)
        );
        const sampledDeleted = sampleArray(
          archiveRowIds,
          Math.min(sampleDeletedSize, archiveRowIds.length)
        );
        approxSamples = { updated: sampledUpdated.length, deleted: sampledDeleted.length };
        const sampledNeed = Array.from(new Set([...sampledUpdated, ...sampledDeleted]));

        oldVecMap = await getOldVectorsForMean(sampledNeed);

        console.warn("embed_value_approx_mode", {
          tenant,
          dataset_id: datasetId,
          need_old_vectors: needOldRowIds.length,
          max_old_vectors_fetch: maxOldVectorsFetch,
          change_ratio: changeRatio,
          strategy_raw: largeChangeStrategyRaw,
          strategy_effective: effectiveStrategy,
          sampled_updated: sampledUpdated.length,
          sampled_deleted: sampledDeleted.length,
          message: "Using sampling-based approximate embed_value update"
        });

        // Approximate delta: scale updates/deletions by sample average.
        if (sampledUpdated.length > 0) {
          const oldUpdated = [];
          const newUpdated = [];
          for (const rid of sampledUpdated) {
            const oldV = oldVecMap.get(rid);
            const newV = updatedVecByRowId.get(rid);
            if (oldV && newV) {
              oldUpdated.push(oldV);
              newUpdated.push(newV);
            }
          }
          const meanOld = meanVector(oldUpdated, dim);
          const meanNew = meanVector(newUpdated, dim);
          if (meanOld && meanNew) {
            // sum += (meanNew - meanOld) * updated_total
            for (let i = 0; i < dim; i++) {
              sum[i] += (meanNew[i] - meanOld[i]) * updatedRowIds.length;
            }
          }
        }
        if (sampledDeleted.length > 0) {
          const oldDeleted = [];
          for (const rid of sampledDeleted) {
            const oldV = oldVecMap.get(rid);
            if (oldV) oldDeleted.push(oldV);
          }
          const meanOldDel = meanVector(oldDeleted, dim);
          if (meanOldDel) {
            for (let i = 0; i < dim; i++) {
              sum[i] -= meanOldDel[i] * archiveRowIds.length;
            }
          }
        }
        }
      }

      // Additions (skip mode avoids changing sum by not updating embed_value itself).
      if (!(approxMode && effectiveStrategy === "skip")) {
        for (const rid of newRowIds) {
          const v = newVecByRowId.get(rid);
          if (v) addVectorsInPlace(sum, v);
        }
      }

      let updatedMissingOld = 0;
      let deletedMissingOld = 0;
      if (!approxMode) {
        // updates: sum += new - old
        for (const rid of updatedRowIds) {
          const newV = updatedVecByRowId.get(rid);
          const oldV = oldVecMap.get(rid);
          if (!newV || !oldV) {
            updatedMissingOld += 1;
            continue;
          }
          addVectorsInPlace(sum, newV);
          subVectorsInPlace(sum, oldV);
        }

        // deletes: sum -= old
        for (const rid of archiveRowIds) {
          const oldV = oldVecMap.get(rid);
          if (!oldV) {
            deletedMissingOld += 1;
            continue;
          }
          subVectorsInPlace(sum, oldV);
        }
      }

      // New total row count (preferably based on FULL file).
      const computedCount = existingCountBefore + newRowIds.length - archiveRowIds.length;
      const finalCount =
        fullRowsCountForMetadata != null ? fullRowsCountForMetadata : computedCount;

      if (finalCount > 0 && !(approxMode && effectiveStrategy === "skip")) {
        embedValue = new Array(dim);
        for (let i = 0; i < dim; i++) embedValue[i] = sum[i] / finalCount;
        embedValueCount = finalCount;
      } else if (finalCount > 0 && (approxMode && effectiveStrategy === "skip")) {
        embedValueCount = finalCount;
      }

      if (!approxMode && (updatedMissingOld || deletedMissingOld)) {
        console.warn("embed_value_old_vectors_missing", {
          tenant,
          dataset_id: datasetId,
          updatedMissingOld,
          deletedMissingOld,
          message: "Some old vectors missing; embed_value update may be approximate"
        });
      }
    }
  }

  if (embedValueInvalid) {
    embedValue = null;
    embedValueCount = null;
  }

  // ========================================================================
  // 7. Upsert in batches (only new rows).
  // ========================================================================
  // Divide points into batches and insert/update them in Qdrant.
  // Batch size: 200 (optimized for Qdrant API performance).
  //
  // ✅ Important: upsert only new rows (cost saving).
  // Note: rowId is based on column values, so if column values change, rowId changes and is handled as delete plus add.
  //
  // ⚠️ Order caution: maintain Upsert → Delete order (to prevent data loss).
  // - Upsert first: save new data first → if it fails, existing data remains (safe).
  // - Delete later: after successful upsert, delete old data → if it fails, duplicates may occur but can retry.
  // - Reversing order (Delete → Upsert) risks data loss if upsert fails (irrecoverable).

  const BATCH = 200; // Batch size.
  let upsertCompleted = false;
  let deleteCompleted = false;

  try {
    // Execute Upsert first (prioritize safety).
    if (points.length > 0) {
      for (let i = 0; i < points.length; i += BATCH) {
        const batch = points.slice(i, i + BATCH); // Extract batches.
        lifecycle.assertActive();
        await qdrant.upsertPoints(collection, batch);
        lifecycle.assertActive();
        console.log("upserted", {
          from: i,
          to: Math.min(points.length, i + BATCH)
        });
      }
    }
    upsertCompleted = true; // Mark upsert as complete

    // ========================================================================
    // 8. Delete from vector DB (delete from Qdrant)
    // ========================================================================
    // Delete removed rows from Qdrant (managed by JSONL, Firestore rows not needed)
    // Run delete only after upsert succeeds (to prevent data loss)
    if (toArchive.length > 0) {
      const archiveRowIds = toArchive.map((a) => a.rowId);
      console.log("deleting_rows_from_qdrant", {
        tenant,
        dataset_id: datasetId,
        count: archiveRowIds.length
      });

      // Delete from vector DB (remove docId filter: manage per row)
      lifecycle.assertActive();
      await qdrant.deleteByRowIds(collection, {
        tenant,
        dataset: datasetId,
        rowIds: archiveRowIds
      });
      lifecycle.assertActive();

      console.log("deleted_rows_completed", {
        tenant,
        dataset_id: datasetId,
        count: archiveRowIds.length
      });
    }
    // If toArchive is empty, treat delete as complete (nothing to delete)
    deleteCompleted = true; // Mark delete as complete
  } catch (error) {
    // Handle errors
    const errorMessage = error?.message || String(error);
    const errorStack = error?.stack;

    if (!upsertCompleted) {
      // Upsert failed: keep existing data (safe)
      console.error("upsert_failed", {
        tenant,
        dataset_id: datasetId,
        error: errorMessage,
        stack: errorStack,
        message: "Upsert failed, existing data preserved. Delete not executed."
      });

      // Send error to Sentry.
      captureError(error, {
        tenant_id: tenant || "empty",
        function_name: "main",
        extra: {
          dataset_id: datasetId,
          operation: "upsert",
          message: "Upsert failed, existing data preserved"
        }
      });

      throw error; // Rethrow error to terminate process
    } else if (!deleteCompleted) {
      // Upsert succeeded but delete failed: new data saved, old data may remain (possible duplicates)
      // This case is recoverable, so only warn and continue (cleanup possible in next step)
      console.warn("delete_failed_after_upsert", {
        tenant,
        dataset_id: datasetId,
        error: errorMessage,
        stack: errorStack,
        message:
          "Delete failed after upsert succeeded. New data is saved, but old data may remain. Retry recommended."
      });

      // Send warning to Sentry (lower level than error)
      captureError(error, {
        tenant_id: tenant || "empty",
        function_name: "main",
        extra: {
          dataset_id: datasetId,
          operation: "delete_after_upsert",
          severity: "warning",
          message:
            "Delete failed after upsert. Data inconsistency possible but recoverable."
        }
      });

      // ⚠️ In production, treat delete failure as complete (duplicates possible but cleaned later)
      // Or throw to enable retry (currently only warning)
      // throw error; // uncomment if retry is needed
    }

    // Unexpected error
    throw error;
  }

  // Retry partial success or restore previous average based on current Qdrant.
  // Read all vectors only after both upsert and delete succeed (no write or re-embedding).
  if (rebuildEmbedValueFromQdrant) {
    lifecycle.assertActive();
    try {
      const recovered = await readDatasetMeanEmbedding(qdrant, collection, {
        tenant, dataset: datasetId, vectorSize: actualVectorSize || vectorSize
      });
      embedValue = recovered.embedValue;
      embedValueCount = recovered.embedValueCount;
    } catch (error) {
      lifecycle.assertActive();
      embedValueInvalid = true;
      embedValue = null;
      embedValueCount = null;
      console.warn("embed_value_recovery_failed_skip", {
        tenant, dataset_id: datasetId, message: error?.message || String(error)
      });
    }
    lifecycle.assertActive();
  }

  // ========================================================================
  // 9. Update token usage
  // ========================================================================
  // Update Firestore with tokens used for embedding generation.
  // ========================================================================
  // 10. Update dataset status and save jsonl_paths (job complete)
  // ========================================================================
  // Change status to "ready" since vector DB save is complete
  // Save fullJsonlGcsPath to jsonl_paths (used as oldJsonlPath for next upload)
  // ✅ Important: save jsonl_paths only after successful completion to ensure data consistency
  try {
    if (getApps().length === 0) {
      initializeApp();
    }
    const db = getFirestore();

    const datasetRef = db
      .collection("tenants")
      .doc(tenant)
      .collection("datasets")
      .doc(datasetId);

    // Add fullJsonlGcsPath to jsonl_paths if present (save only on success)
    const updateData = {
      status: DatasetStatus.READY,
      processing_job_id: FieldValue.delete(), // Remove processing_job_id on job completion
      updated_at: Date.now(),
      error: "" // Clear stored error on success after previous failure
    };

    // Do not keep previous average when recovering an empty dataset.
    if (rebuildEmbedValueFromQdrant) {
      updateData.embed_value = embedValue;
      updateData.embed_value_count = embedValueCount;
    }
    // Save average embedding per dataset (used for dataset selection when over 100k entries)
    if (embedValue && embedValue.length > 0) {
      updateData.embed_value = embedValue;
      if (typeof embedValueCount === "number" && embedValueCount > 0) {
        updateData.embed_value_count = embedValueCount;
      }
    }
    if (rebuildEmbedValueFromQdrant || (embedValue && embedValue.length > 0)) {
      updateData.embed_value_basis = EMBED_VALUE_BASIS;
    }
    // Invalidate failed averages and counts to avoid reuse as baseline for next increment.
    if (embedValueInvalid) {
      updateData.embed_value = null;
      updateData.embed_value_count = FieldValue.delete();
      updateData.embed_value_basis = FieldValue.delete();
    }
    // Keep existing embed_value but adjust count if total row count is known.
    if (
      !embedValueInvalid &&
      updateData.embed_value_count == null &&
      fullRowsCountForMetadata != null &&
      fullRowsCountForMetadata > 0
    ) {
      updateData.embed_value_count = fullRowsCountForMetadata;
    }

    // Add FULL_GCS_PATH to jsonl_paths (save only on success)
    if (
      deleteDetectionGsPath &&
      deleteDetectionGsPath !== gsPath &&
      fullRowsCountForMetadata != null
    ) {
      // Add full JSONL path to jsonl_paths
      // This path is used as oldJsonlPath in next uploadDataset.js run
      updateData.jsonl_paths = FieldValue.arrayUnion({
        gcs_path: deleteDetectionGsPath,
        created_at: Date.now(),
        rows_count: fullRowsCountForMetadata, // Total row count
        to_add_count: newRowsCount, // Number of newly added rows
        to_update_count: updatedRowsCount, // Number of changed rows
        to_archive_count: toArchive.length // Number of deleted rows
      });
    }

    lifecycle.assertActive();
    let statusUpdated = false;
    await db.runTransaction(async (transaction) => {
      statusUpdated = false;
      const snapshot = await transaction.get(datasetRef);
      if (
        !snapshot.exists ||
        snapshot.data()?.processing_job_id !== jobId
      ) {
        return;
      }
      transaction.set(datasetRef, updateData, { merge: true });
      statusUpdated = true;
    });

    // Set tenant document status to "active" on job completion
    if (statusUpdated) {
      const tenantRef = db.collection("tenants").doc(tenant);
      try {
        await tenantRef.set(
          { status: "active", updated_at: Date.now() },
          { merge: true }
        );
      } catch (tenantStatusError) {
        console.warn("tenant_status_update_failed", {
          tenant,
          dataset_id: datasetId,
          error: tenantStatusError?.message || String(tenantStatusError)
        });
        captureError(
          tenantStatusError instanceof Error
            ? tenantStatusError
            : new Error(String(tenantStatusError)),
          {
            tenant_id: tenant || "empty",
            function_name: "ingestWorker",
            extra: {
              dataset_id: datasetId,
              job_id: jobId,
              operation: "tenant_status_active",
              alert_code: "ingest_tenant_status_update_failed"
            }
          }
        );
      }
    }

    console.log("dataset_status_updated", {
      tenant,
      dataset_id: datasetId,
      status: DatasetStatus.READY,
      full_jsonl_path:
        deleteDetectionGsPath !== gsPath ? deleteDetectionGsPath : null,
      job_id: jobId,
      status_updated: statusUpdated,
      message: statusUpdated
        ? "Dataset status updated to ready and jsonl_paths updated"
        : "Dataset ready update skipped because job ownership changed"
    });
    if (statusUpdated) {
      console.log("tenant_status_updated", {
        tenant,
        status: "active",
        message: "Tenant status set to active after job completion"
      });
    }
  } catch (statusUpdateError) {
    console.error("dataset_status_update_failed", {
      tenant,
      dataset_id: datasetId,
      error: statusUpdateError?.message || String(statusUpdateError),
      stack: statusUpdateError?.stack
    });

    // Send error to Sentry.
    captureError(statusUpdateError, {
      tenant_id: tenant || "empty",
      function_name: "main",
      extra: {
        dataset_id: datasetId,
        message: "Dataset status update failed"
      }
    });
    throw new IngestExecutionError("Dataset READY status update failed", {
      cause:
        statusUpdateError instanceof Error
          ? statusUpdateError
          : new Error(String(statusUpdateError)),
      retryable: true,
      code: "DATASET_READY_UPDATE_FAILED"
    });
  }

  // ========================================================================
  // 11. Completion log
  // ========================================================================
  const elapsedMs = Date.now() - jobStartedAt;
  const elapsedSeconds = (elapsedMs / 1000).toFixed(2);

  console.log("done", {
    jobId, // Job ID
    tenant, // Tenant ID
    dataset_id: datasetId, // Dataset ID
    total: points.length, // Total points count (only changed ones)
    to_add: toAdd.length,
    to_archive: toArchive.length,
    collection, // Collection name
    embedModel, // Embedding model
    qdrantUrl, // Qdrant URL
    total_tokens: totalTokens, // Number of tokens used
    elapsed_ms: elapsedMs, // Elapsed time from job start to end (ms)
    elapsed_seconds: elapsedSeconds // Elapsed time from job start to end (seconds)
  });

  return {
    outcome: "completed",
    skipped: false,
    retryable: false,
    tenant,
    datasetId,
    jobId,
    collection,
    total: points.length,
    toAdd: toAdd.length,
    toArchive: toArchive.length,
    totalTokens,
    elapsedMs
  };
}

// ============================================================================
// Remove Schema Version status update
// ============================================================================
// Versioning is done only per row (remove versions collection per dataset)

// ============================================================================
// Run main function and handle errors
// ============================================================================

/**
 * Determine if error is retryable
 *
 * Retryable errors: network errors, temporary service failures, errors that can be resolved by retrying
 * Non-retryable errors: timeouts, configuration errors, data errors, errors that won't be fixed by retrying
 *
 * Decision order:
 * 1. If non-retryable pattern is found → not retryable
 * 2. If retryable pattern is found → retryable
 * 3. If HTTP status code is 5xx → retryable
 * 4. Default → not retryable (safe handling)
 *
 * @param {Error} error - Error object
 * @returns {boolean} - Whether retry is possible (true: retryable, false: not retryable)
 *
 * @example
 * isRetryableError(new Error("ECONNREFUSED")) // true (network error)
 * isRetryableError(new TypeError("fetch failed")) // true (undici network error)
 * isRetryableError(new Error("Job timeout")) // false (job timeout)
 * isRetryableError(new Error("TENANT is required")) // false (configuration error)
 */
function isRetryableError(error) {
  // For undici etc.: message is "fetch failed" but actual cause is often in error.cause
  const cause = error?.cause;
  const errorMessage = [
    error?.message,
    error?.code,
    cause?.message,
    cause?.code,
    cause?.errno,
    cause?.syscall
  ]
    .filter((v) => v != null && String(v).trim() !== "")
    .map((v) => String(v).toLowerCase())
    .join(" ");
  const errorStatus = error?.status || error?.statusCode || 0;

  // Retryable error patterns
  const retryablePatterns = [
    // Network errors (Node fetch/undici: TypeError "fetch failed")
    "fetch failed",
    "econnrefused",
    "econnreset",
    "etimedout",
    "econnaborted",
    "epipe",
    "timed out",
    "abort",
    "aborted",
    "enotfound",
    "eai_again",
    "network",
    "connection",
    "connection timeout", // Network connection timeout (temporary)
    // GCS errors
    "storage",
    "bucket",
    "download",
    // Qdrant errors
    "qdrant",
    "connection refused",
    // Firestore errors
    "firestore",
    "deadline exceeded",
    // Temporary service errors
    "503",
    "502",
    "504",
    "service unavailable",
    "bad gateway",
    "gateway timeout"
  ];

  // Non-retryable error patterns (configuration errors, data errors, etc.)
  const nonRetryablePatterns = [
    // Configuration errors
    "is required",
    "invalid",
    "missing",
    "not found",
    // Data errors
    "vector size mismatch",
    "vector dimension error",
    "invalid embedding vector dimension",
    "no valid rows",
    "parsing",
    // Concurrency errors
    "another indexing job",
    "already running",
    // Timeouts (too much data)
    "job timeout",
    "execution exceeded"
  ];

  // If non-retryable error is found, do not retry
  if (nonRetryablePatterns.some((pattern) => errorMessage.includes(pattern))) {
    return false;
  }

  // If retryable error pattern is found, retry
  if (retryablePatterns.some((pattern) => errorMessage.includes(pattern))) {
    return true;
  }

  // Determine by HTTP status code
  if (errorStatus >= 500 && errorStatus < 600) {
    return true; // 5xx server errors are retryable.
  }

  // Default: no retry (handled safely).
  return false;
}

function classifyIngestError(error) {
  const retryable =
    typeof error?.retryable === "boolean"
      ? error.retryable
      : isRetryableError(error);
  return {
    retryable,
    code: error?.code || (retryable ? "INGEST_RETRYABLE" : "INGEST_NON_RETRYABLE"),
    httpStatus: retryable ? 503 : 422
  };
}

function toIngestExecutionError(error, classification) {
  if (error instanceof IngestExecutionError) return error;
  return new IngestExecutionError(error?.message || String(error), {
    cause: error instanceof Error ? error : undefined,
    retryable: classification.retryable,
    statusHandled: error?.statusHandled === true,
    code: classification.code
  });
}

async function runIngest(options = {}) {
  const tenant = String(options?.tenant ?? "").trim();
  const datasetId = String(options?.datasetId ?? "default").trim();
  const datasetLocale = normalizeWorkerLocale(options?.datasetLocale);
  const jobId = String(options?.jobId ?? "local").trim() || "local";
  const lifecycle = createInvocationLifecycle({
    tenant,
    datasetId,
    datasetLocale,
    jobId
  });
  const executionPromise = executeIngest(options, lifecycle);

  try {
    // Response is returned only after the actual execution settles; the 18.5-minute timer is ongoing.
    // Aborts I/O, fails cooperative assertion, and leaves no detached execution.
    return await executionPromise;
  } catch (rawError) {
    const caughtError =
      lifecycle.isTerminating() && lifecycle.getTerminationError()
        ? lifecycle.getTerminationError()
        : rawError;
    const classification = classifyIngestError(caughtError);
    const error = toIngestExecutionError(caughtError, classification);

    console.error("worker_execution_failed", {
      tenant: tenant || "empty",
      dataset_id: datasetId || "empty",
      error: error.message,
      error_cause: error.cause
        ? {
            message: error.cause?.message || String(error.cause),
            code: error.cause?.code,
            errno: error.cause?.errno,
            syscall: error.cause?.syscall,
            address: error.cause?.address,
            port: error.cause?.port
          }
        : null,
      stack: error.stack,
      is_retryable: classification.retryable,
      message: "Worker execution failed. Will attempt status update if possible."
    });

    if (
      tenant &&
      datasetId &&
      !error.statusHandled &&
      !classification.retryable
    ) {
      try {
        const failureResult = await updateStatusToFailedAndCleanup(
          tenant,
          datasetId,
          error.message,
          datasetLocale,
          jobId
        );
        error.statusHandled = failureResult?.handled === true;
      } catch (statusUpdateError) {
        console.error("dataset_status_update_to_failed_failed", {
          tenant,
          dataset_id: datasetId,
          error: statusUpdateError?.message || String(statusUpdateError),
          stack: statusUpdateError?.stack
        });
        captureError(statusUpdateError, {
          tenant_id: tenant || "empty",
          function_name: "updateStatusToFailedAndCleanup",
          extra: {
            dataset_id: datasetId,
            operation: "dataset_status_update_to_failed"
          }
        });
        throw new IngestExecutionError("Dataset FAILED status update failed", {
          cause:
            statusUpdateError instanceof Error
              ? statusUpdateError
              : new Error(String(statusUpdateError)),
          retryable: true,
          statusHandled: false,
          code: "DATASET_FAILED_UPDATE_FAILED"
        });
      }
    } else if (classification.retryable) {
      console.warn("retryable_error_occurred", {
        tenant: tenant || "empty",
        dataset_id: datasetId || "empty",
        error: error.message,
        message: "Retryable error occurred. Status not updated to allow an HTTP adapter retry."
      });
    }

    captureError(error, {
      tenant_id: tenant || "empty",
      function_name: "runIngest",
      extra: {
        dataset_id: datasetId,
        is_retryable: classification.retryable,
        error_code: classification.code
      }
    });
    await flushSentry();
    throw error;
  } finally {
    lifecycle.cleanup();
  }
}

module.exports = {
  runIngest,
  IngestExecutionError,
  classifyIngestError,
  isRetryableError
};
