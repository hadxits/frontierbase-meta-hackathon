/**
 * getArsMenu — widget: published ARS tree for one dataset.
 * Loads published tree from GCS (legacy inline published_tree still supported).
 * When dataset_ids is empty, resolves the tenant's single active dataset (same idea as streamChat).
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const DatasetStatus = require("@/const/DatasetStatus");
const { menuRef } = require("@/utils/arsMappingCore");
const { loadPublishedTree } = require("@/utils/arsGcs");

async function loadPluginDefault(tenantId) {
  const snap = await store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.PLUGIN)
    .doc("default")
    .get();
  return snap.exists ? snap.data() || {} : {};
}

/** Active datasets for ARS: ready only (not indexing/failed/paused/deleted). */
async function listActiveDatasetIds(tenantId) {
  const snap = await store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.DATASETS)
    .select("status")
    .get();

  const ids = [];
  for (const doc of snap.docs) {
    if (doc.data()?.status !== DatasetStatus.READY) continue;
    ids.push(doc.id);
  }
  return ids;
}

module.exports = _onRequest({
  opts: {
    memory: "512MiB",
    timeoutSeconds: 60,
    cors: true,
    maxInstances: 10,
    concurrency: 40
  },
  requireCredential: false,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant_id: { type: PropertyType.STRING },
      dataset_id: { type: PropertyType.STRING },
      dataset_ids: { type: PropertyType.ARRAY }
    },
    required: ["tenant_id"],
    additionalProperties: true
  },
  handler: async (req) => {
    const tenant_id = String(req.body.tenant_id || "").trim();
    let dataset_id = String(req.body.dataset_id || "").trim();
    const dataset_ids = Array.isArray(req.body.dataset_ids)
      ? req.body.dataset_ids.map((x) => String(x).trim()).filter(Boolean)
      : [];

    if (!tenant_id) {
      throw new ApiError({
        errorCode: "INVALID_REQUEST",
        message: "tenant_id required",
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const plugin = await loadPluginDefault(tenant_id);
    if (plugin.ars_enabled !== true) {
      return {
        success: true,
        enabled: false,
        reason: "ars_disabled",
        tree: null
      };
    }

    if (dataset_ids.length > 1) {
      return {
        success: true,
        enabled: false,
        reason: "multiple_datasets",
        tree: null
      };
    }

    if (!dataset_id && dataset_ids.length === 1) {
      dataset_id = dataset_ids[0];
    }
    if (!dataset_id) {
      const activeIds = await listActiveDatasetIds(tenant_id);
      if (activeIds.length === 0) {
        return {
          success: true,
          enabled: false,
          reason: "no_dataset",
          tree: null
        };
      }
      if (activeIds.length > 1) {
        return {
          success: true,
          enabled: false,
          reason: "multiple_datasets",
          tree: null
        };
      }
      dataset_id = activeIds[0];
    }

    const snap = await menuRef(tenant_id, dataset_id).get();
    if (!snap.exists) {
      return {
        success: true,
        enabled: false,
        reason: "no_menu",
        dataset_id,
        tree: null
      };
    }
    const data = snap.data() || {};
    // Keep serving last published tree while remap runs (draft/mapping status).
    const tree = await loadPublishedTree(data);
    if (!tree) {
      return {
        success: true,
        enabled: false,
        reason: "no_published_tree",
        dataset_id,
        status: data.status || null,
        tree: null
      };
    }

    return {
      success: true,
      enabled: true,
      dataset_id,
      default_mode: (() => {
        const m = String(plugin.ars?.default_mode || plugin.ars_default_mode || "chat").trim();
        if (m === "ars" || m === "chat_only" || m === "ars_only" || m === "chat") return m;
        return "chat";
      })(),
      tree,
      published_at: data.published_at || null,
      published_tree_gcs_path: data.published_tree_gcs_path || null
    };
  }
});
