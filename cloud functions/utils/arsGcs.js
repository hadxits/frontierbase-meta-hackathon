/**
 * ARS: dataset JSONL read + menu tree/labels JSON in GCS.
 * Large tree/row_labels live in GCS; Firestore ars_menus keeps paths + status meta.
 */
const { storage } = require("@/firebase");
const { parseJsonlToRows } = require("@/utils/jsonl");

const DEFAULT_GCS_BUCKET =
  process.env.GCS_BUCKET || "frontierbase-console.firebasestorage.app";

/** @typedef {'draft_tree'|'draft_row_labels'|'published_tree'} ArsGcsKind */

function parseGsPath(gsPath) {
  const m = String(gsPath || "").match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Invalid GCS path: ${gsPath}`);
  return { bucket: m[1], name: m[2] };
}

/**
 * @param {object|null|undefined} datasetData
 * @returns {string|null}
 */
function getLastFullJsonlPath(datasetData) {
  const paths = Array.isArray(datasetData?.jsonl_paths)
    ? datasetData.jsonl_paths
    : [];
  for (let i = paths.length - 1; i >= 0; i -= 1) {
    const p = paths[i];
    const gcs =
      typeof p === "string"
        ? p
        : typeof p?.gcs_path === "string"
          ? p.gcs_path
          : "";
    if (gcs.startsWith("gs://")) return gcs.trim();
  }
  const ref = String(datasetData?.source_ref || "").trim();
  return ref.startsWith("gs://") ? ref : null;
}

/**
 * @param {string} gsPath
 * @returns {Promise<Array<{rowId: string, text: string, version: number, rowMeta?: object|null}>>}
 */
async function loadJsonlRowsFromGs(gsPath) {
  const { bucket, name } = parseGsPath(gsPath);
  const [buf] = await storage.bucket(bucket).file(name).download();
  const text = buf.toString("utf8");
  const { rows } = parseJsonlToRows(text);
  return rows;
}

/**
 * @param {string} tenantId
 * @param {string} datasetId
 * @param {ArsGcsKind} kind
 */
function arsMenuObjectPath(tenantId, datasetId, kind) {
  const safeKind = String(kind || "").replace(/[^a-z0-9_]/gi, "");
  return `ars/${tenantId}/${datasetId}/${safeKind}.json`;
}

/**
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.datasetId
 * @param {ArsGcsKind} opts.kind
 * @param {object|array} opts.data
 * @returns {Promise<string>} gs:// path
 */
async function saveArsJson({ tenantId, datasetId, kind, data }) {
  const objectPath = arsMenuObjectPath(tenantId, datasetId, kind);
  const file = storage.bucket(DEFAULT_GCS_BUCKET).file(objectPath);
  await file.save(JSON.stringify(data), {
    resumable: false,
    metadata: {
      contentType: "application/json",
      metadata: {
        tenant_id: String(tenantId),
        dataset_id: String(datasetId),
        ars_kind: String(kind)
      }
    }
  });
  return `gs://${DEFAULT_GCS_BUCKET}/${objectPath}`;
}

/**
 * @param {string} gsPath
 * @returns {Promise<object|array|null>}
 */
async function loadArsJson(gsPath) {
  if (!gsPath || !String(gsPath).startsWith("gs://")) return null;
  const { bucket, name } = parseGsPath(gsPath);
  const file = storage.bucket(bucket).file(name);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  return JSON.parse(buf.toString("utf8"));
}

/**
 * Draft tree for remap/publish/console. Prefers GCS, falls back to inline FS.
 * @param {object} menuData
 * @returns {Promise<object|null>}
 */
async function loadDraftTree(menuData) {
  const data = menuData || {};
  if (data.tree_gcs_path) {
    const fromGcs = await loadArsJson(data.tree_gcs_path);
    if (fromGcs) return fromGcs;
  }
  if (data.tree && typeof data.tree === "object") return data.tree;
  return null;
}

/**
 * Published tree for widget runtime.
 * @param {object} menuData
 * @returns {Promise<object|null>}
 */
async function loadPublishedTree(menuData) {
  const data = menuData || {};
  if (data.published_tree_gcs_path) {
    const fromGcs = await loadArsJson(data.published_tree_gcs_path);
    if (fromGcs) return fromGcs;
  }
  if (data.published_tree && typeof data.published_tree === "object") {
    return data.published_tree;
  }
  return null;
}

/**
 * @param {object} menuData
 * @returns {Promise<Array|null>}
 */
async function loadRowLabels(menuData) {
  const data = menuData || {};
  if (data.row_labels_gcs_path) {
    const fromGcs = await loadArsJson(data.row_labels_gcs_path);
    if (Array.isArray(fromGcs)) return fromGcs;
  }
  if (Array.isArray(data.row_labels)) return data.row_labels;
  return null;
}

/**
 * True if a draft tree exists (GCS path or legacy inline).
 * @param {object} menuData
 */
function hasDraftTree(menuData) {
  const data = menuData || {};
  return !!(data.tree_gcs_path || data.tree);
}

module.exports = {
  parseGsPath,
  getLastFullJsonlPath,
  loadJsonlRowsFromGs,
  DEFAULT_GCS_BUCKET,
  saveArsJson,
  loadDraftTree,
  loadPublishedTree,
  loadRowLabels,
  hasDraftTree
};
