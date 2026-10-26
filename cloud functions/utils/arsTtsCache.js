/**
 * ARS ElevenLabs TTS audio cache in GCS.
 * Path: ars/{tenantId}/tts/{sha256(exactText)}.mp3
 */
const crypto = require("crypto");
const { storage } = require("@/firebase");
const { DEFAULT_GCS_BUCKET } = require("@/utils/arsGcs");
const { logWarn, logDebug } = require("@/utils/logger");

/** Reject tiny/corrupt objects; real mp3 is much larger. */
const MIN_TTS_CACHE_BYTES = 32;

/**
 * Cache key from exact spoken sentence (no trim / whitespace normalize).
 * @param {string} text
 * @returns {string} hex sha256
 */
function buildTtsCacheKey(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

/**
 * @param {string} tenantId
 * @param {string} hash
 * @returns {string}
 */
function ttsCacheObjectPath(tenantId, hash) {
  const tid = String(tenantId || "").trim();
  const h = String(hash || "")
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "");
  if (!tid || !h) throw new Error("ttsCacheObjectPath requires tenantId and hash");
  return `ars/${tid}/tts/${h}.mp3`;
}

/**
 * @param {string} tenantId
 * @param {string} hash
 * @returns {Promise<Buffer|null>}
 */
async function loadTtsCache(tenantId, hash) {
  const tid = String(tenantId || "");
  const hashShort = String(hash || "").slice(0, 16);
  try {
    const objectPath = ttsCacheObjectPath(tenantId, hash);
    const file = storage.bucket(DEFAULT_GCS_BUCKET).file(objectPath);
    const t0 = Date.now();
    const [exists] = await file.exists();
    if (!exists) {
      logDebug("[arsTtsCache] miss (not found)", {
        tenant_id: tid,
        function_name: "loadTtsCache",
        extra: {
          step: "gcs_not_found",
          hash: hashShort,
          bucket: DEFAULT_GCS_BUCKET,
          path: objectPath,
          elapsed_ms: Date.now() - t0
        }
      });
      return null;
    }
    const [buf] = await file.download();
    if (!buf || !Buffer.isBuffer(buf) || buf.length < MIN_TTS_CACHE_BYTES) {
      logDebug("[arsTtsCache] miss (too small / invalid)", {
        tenant_id: tid,
        function_name: "loadTtsCache",
        extra: {
          step: "gcs_invalid",
          hash: hashShort,
          path: objectPath,
          audio_bytes: buf && Buffer.isBuffer(buf) ? buf.length : 0,
          min_bytes: MIN_TTS_CACHE_BYTES,
          elapsed_ms: Date.now() - t0
        }
      });
      return null;
    }
    logDebug("[arsTtsCache] hit", {
      tenant_id: tid,
      function_name: "loadTtsCache",
      extra: {
        step: "gcs_hit",
        hash: hashShort,
        path: objectPath,
        audio_bytes: buf.length,
        elapsed_ms: Date.now() - t0
      }
    });
    return buf;
  } catch (e) {
    logWarn("[arsTtsCache] load failed; treating as miss", {
      tenant_id: tid,
      function_name: "loadTtsCache",
      extra: {
        step: "gcs_load_error",
        hash: hashShort,
        error: e?.message || String(e)
      }
    });
    return null;
  }
}

/**
 * @param {string} tenantId
 * @param {string} hash
 * @param {Buffer} buffer
 * @returns {Promise<string>} gs:// path
 */
async function saveTtsCache(tenantId, hash, buffer) {
  const objectPath = ttsCacheObjectPath(tenantId, hash);
  const file = storage.bucket(DEFAULT_GCS_BUCKET).file(objectPath);
  const t0 = Date.now();
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: "audio/mpeg",
      metadata: {
        tenant_id: String(tenantId),
        ars_kind: "tts"
      }
    }
  });
  const gsPath = `gs://${DEFAULT_GCS_BUCKET}/${objectPath}`;
  logDebug("[arsTtsCache] saved", {
    tenant_id: String(tenantId || ""),
    function_name: "saveTtsCache",
    extra: {
      step: "gcs_saved",
      hash: String(hash || "").slice(0, 16),
      path: objectPath,
      audio_bytes: buffer?.length || 0,
      elapsed_ms: Date.now() - t0
    }
  });
  return gsPath;
}

module.exports = {
  buildTtsCacheKey,
  loadTtsCache,
  saveTtsCache
};
