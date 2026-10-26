/**
 * getArsMenuTree — console: load draft or published ARS tree from GCS.
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { loadAndValidateTenant } = require("@/utils/tenant");
const { menuRef } = require("@/utils/arsMappingCore");
const { loadDraftTree, loadPublishedTree } = require("@/utils/arsGcs");

module.exports = _onRequest({
  opts: {
    memory: "512MiB",
    timeoutSeconds: 60,
    maxInstances: 4,
    concurrency: 5
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      dataset_id: { type: PropertyType.STRING },
      source: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING }
    },
    required: ["tenant", "dataset_id"]
  },
  handler: async (req) => {
    const tenant = String(req.body.tenant || "").trim();
    const dataset_id = String(req.body.dataset_id || "").trim();
    const source = String(req.body.source || "draft")
      .trim()
      .toLowerCase();
    const locale = String(req.body.locale || "en").trim() || "en";

    await loadAndValidateTenant(tenant, {
      locale,
      functionName: "getArsMenuTree",
      requireQdrantUrl: false
    });

    const snap = await menuRef(tenant, dataset_id).get();
    if (!snap.exists) {
      throw new ApiError({
        errorCode: "NOT_FOUND",
        message: "ARS menu not found",
        httpStatusCode: 404,
        returnToUser: true
      });
    }
    const data = snap.data() || {};
    const tree =
      source === "published"
        ? await loadPublishedTree(data)
        : (await loadDraftTree(data)) || (await loadPublishedTree(data));

    if (!tree) {
      return {
        success: true,
        dataset_id,
        status: data.status || null,
        tree: null,
        tree_gcs_path: data.tree_gcs_path || null,
        published_tree_gcs_path: data.published_tree_gcs_path || null
      };
    }

    return {
      success: true,
      dataset_id,
      status: data.status || null,
      source: source === "published" ? "published" : "draft",
      tree,
      tree_gcs_path: data.tree_gcs_path || null,
      published_tree_gcs_path: data.published_tree_gcs_path || null,
      grouping_meta: data.grouping_meta || null
    };
  }
});
