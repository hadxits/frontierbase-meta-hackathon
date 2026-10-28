/**
 * publishArsMenu — console: draft tree → published.
 * Blocks publish while any leaf has needs_review.
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { randomUUID } = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { loadAndValidateTenant } = require("@/utils/tenant");
const { menuRef } = require("@/utils/arsMappingCore");
const { commitArsDraft } = require("@/utils/arsDraft");
const { MAX_ARS_ANSWER_LENGTH } = require("@/const/ArsLimits");
const { listLeaves } = require("@/utils/arsGrouping");
const {
  ARS_MENU_STATUS,
  isArsProcessingStatus
} = require("@/const/ArsMenuStatus");
const { loadDraftTree, saveArsJson } = require("@/utils/arsGcs");

function stripTreeForPublish(node) {
  if (!node || typeof node !== "object") return node;
  const out = { ...node };
  delete out.answer_candidates;
  if (Array.isArray(out.children)) {
    out.children = out.children.map(stripTreeForPublish);
  }
  return out;
}

function normalizeArsDefaultMode(mode) {
  const m = String(mode || "").trim();
  if (m === "ars" || m === "chat_only" || m === "ars_only" || m === "chat")
    return m;
  return "chat";
}

/** Widget uses ARS when plugin enables it and mode is not chat-only. */
function pluginUsesArs(plugin) {
  if (!plugin || plugin.ars_enabled !== true) return false;
  return (
    normalizeArsDefaultMode(
      plugin.ars?.default_mode || plugin.ars_default_mode
    ) !== "chat_only"
  );
}

async function loadPluginDefault(tenantId) {
  const snap = await store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.PLUGIN)
    .doc("default")
    .get();
  return snap.exists ? snap.data() || {} : {};
}

module.exports = _onRequest({
  opts: {
    memory: "512MiB",
    timeoutSeconds: 120,
    maxInstances: 4,
    concurrency: 2
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      dataset_id: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING }
    },
    required: ["tenant", "dataset_id"]
  },
  handler: async (req) => {
    const tenant = String(req.body.tenant || "").trim();
    const dataset_id = String(req.body.dataset_id || "").trim();
    const locale = String(req.body.locale || "en").trim() || "en";

    await loadAndValidateTenant(tenant, {
      locale,
      functionName: "publishArsMenu",
      requireQdrantUrl: false
    });

    const plugin = await loadPluginDefault(tenant);
    if (!pluginUsesArs(plugin)) {
      throw new ApiError({
        errorCode: "ARS_MODE_DISABLED",
        message:
          "Enable ARS and set Default mode (not Chat only) in Channel settings > Channel management > ARS before publishing",
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const ref = menuRef(tenant, dataset_id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new ApiError({
        errorCode: "NOT_FOUND",
        message: "ARS menu draft not found",
        httpStatusCode: 404,
        returnToUser: true
      });
    }
    const data = snap.data() || {};
    const draftTree = await loadDraftTree(data);
    if (!draftTree) {
      throw new ApiError({
        errorCode: "NO_DRAFT",
        message: "No ARS draft tree to publish",
        httpStatusCode: 400,
        returnToUser: true
      });
    }
    if (isArsProcessingStatus(data.status)) {
      throw new ApiError({
        errorCode: "STILL_PROCESSING",
        message: "ARS mapping still in progress",
        httpStatusCode: 409,
        returnToUser: true
      });
    }
    if (data.status === ARS_MENU_STATUS.FAILED) {
      throw new ApiError({
        errorCode: "ARS_FAILED",
        message: "Cannot publish a failed ARS mapping; remap first",
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const published_tree = stripTreeForPublish(draftTree);
    const leaves = listLeaves(published_tree);
    const needsReview = leaves.filter((l) => l.needs_review).length;
    if (needsReview > 0) {
      throw new ApiError({
        errorCode: "NEEDS_REVIEW",
        message: `Cannot publish while ${needsReview} leaf(ves) need review`,
        httpStatusCode: 400,
        returnToUser: true
      });
    }
    if (leaves.some((leaf) => String(leaf.answer_text || "").length > MAX_ARS_ANSWER_LENGTH)) {
      throw new ApiError({
        errorCode: "TEXT_TOO_LONG",
        message: `ARS answers must be at most ${MAX_ARS_ANSWER_LENGTH} characters`,
        httpStatusCode: 400,
        returnToUser: true
      });
    }
    const now = Date.now();
    const writeId = randomUUID();

    const [tree_gcs_path, published_tree_gcs_path] = await Promise.all([
      saveArsJson({
        tenantId: tenant,
        datasetId: dataset_id,
        kind: "draft_tree",
        jobId: writeId,
        data: published_tree
      }),
      saveArsJson({
        tenantId: tenant,
        datasetId: dataset_id,
        kind: "published_tree",
        jobId: writeId,
        data: published_tree
      })
    ]);

    await commitArsDraft({
      tenantId: tenant,
      datasetId: dataset_id,
      expected: data,
      menuPatch: {
        status: ARS_MENU_STATUS.PUBLISHED,
        tree_gcs_path,
        published_tree_gcs_path,
        published_at: now,
        updated_at: now,
        tree: FieldValue.delete(),
        published_tree: FieldValue.delete(),
        row_labels: FieldValue.delete(),
        grouping_meta: {
          ...(data.grouping_meta || {}),
          needs_review_count: 0,
          published_with_needs_review: false
        }
      },
      datasetPatch: {
        status: ARS_MENU_STATUS.PUBLISHED,
        last_mapped_at: data.source_mapped_at || now,
        last_mapped_jsonl_path: data.source_jsonl_path || null,
        published_at: now,
        published_tree_gcs_path,
        tree_gcs_path,
        updated_at: now
      }
    });

    return {
      success: true,
      dataset_id,
      status: ARS_MENU_STATUS.PUBLISHED,
      leaf_count: leaves.length,
      needs_review_count: needsReview,
      published_tree_gcs_path,
      warning:
        needsReview > 0 ? "Published with needs_review leaves remaining" : null
    };
  }
});
