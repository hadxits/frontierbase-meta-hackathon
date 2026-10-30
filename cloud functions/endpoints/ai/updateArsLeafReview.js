/**
 * updateArsLeafReview — console: edit leaf answer and/or clear needs_review on draft tree.
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { randomUUID } = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");
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

function findNodeByPath(tree, pathKeys) {
  let node = tree;
  for (const key of pathKeys || []) {
    const kids = Array.isArray(node?.children) ? node.children : [];
    const next = kids.find((c) => String(c.key) === String(key));
    if (!next) return null;
    node = next;
  }
  return node;
}

function isLeafNode(node) {
  if (!node || typeof node !== "object") return false;
  const kids = Array.isArray(node.children) ? node.children : [];
  return kids.length === 0;
}

module.exports = _onRequest({
  opts: {
    memory: "512MiB",
    timeoutSeconds: 60,
    maxInstances: 10,
    concurrency: 2
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      dataset_id: { type: PropertyType.STRING },
      path_keys: {
        type: PropertyType.ARRAY,
        items: { type: PropertyType.STRING }
      },
      answer_text: { type: PropertyType.STRING },
      approve: { type: PropertyType.BOOLEAN },
      locale: { type: PropertyType.STRING }
    },
    required: ["tenant", "dataset_id", "path_keys"]
  },
  handler: async (req) => {
    const tenant = String(req.body.tenant || "").trim();
    const dataset_id = String(req.body.dataset_id || "").trim();
    const path_keys = (
      Array.isArray(req.body.path_keys) ? req.body.path_keys : []
    ).map((k) => String(k));
    const approve = req.body.approve === true;
    const hasAnswer = Object.prototype.hasOwnProperty.call(
      req.body,
      "answer_text"
    );
    const answer_text = hasAnswer
      ? String(req.body.answer_text ?? "").trim()
      : null;
    const locale = String(req.body.locale || "en").trim() || "en";

    if (!path_keys.length) {
      throw new ApiError({
        errorCode: "INVALID_PATH",
        message: "path_keys must point to a leaf (non-root)",
        httpStatusCode: 400,
        returnToUser: true
      });
    }
    if (!approve && !hasAnswer) {
      throw new ApiError({
        errorCode: "NO_OP",
        message: "Provide answer_text and/or approve:true",
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    await loadAndValidateTenant(tenant, {
      locale,
      functionName: "updateArsLeafReview",
      requireQdrantUrl: false
    });

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
    if (isArsProcessingStatus(data.status)) {
      throw new ApiError({
        errorCode: "STILL_PROCESSING",
        message: "ARS mapping still in progress",
        httpStatusCode: 409,
        returnToUser: true
      });
    }

    const tree = await loadDraftTree(data);
    if (!tree) {
      throw new ApiError({
        errorCode: "NO_DRAFT",
        message: "No ARS draft tree to update",
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const leaf = findNodeByPath(tree, path_keys);
    if (!leaf || !isLeafNode(leaf)) {
      throw new ApiError({
        errorCode: "LEAF_NOT_FOUND",
        message: "No leaf at the given path_keys",
        httpStatusCode: 404,
        returnToUser: true
      });
    }

    if (hasAnswer) {
      if (!answer_text) {
        throw new ApiError({
          errorCode: "EMPTY_ANSWER",
          message: "answer_text cannot be empty",
          httpStatusCode: 400,
          returnToUser: true
        });
      }
      leaf.answer_text = answer_text;
    }

    if (String(leaf.answer_text || "").trim().length > MAX_ARS_ANSWER_LENGTH) {
      throw new ApiError({
        errorCode: "TEXT_TOO_LONG",
        message: `ARS answer must be at most ${MAX_ARS_ANSWER_LENGTH} characters`,
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    if (approve && Array.isArray(leaf.quality_blockers) && leaf.quality_blockers.length) {
      throw new ApiError({
        errorCode: "MENU_QUALITY_BLOCKED",
        message: "Menu routing or structure needs correction; editing the answer alone cannot approve it. Remap first.",
        httpStatusCode: 400,
        returnToUser: true
      });
    }
    if (approve) {
      const finalAnswer = String(leaf.answer_text || "").trim();
      if (!finalAnswer) {
        throw new ApiError({
          errorCode: "EMPTY_ANSWER",
          message: "Cannot approve a leaf without answer_text",
          httpStatusCode: 400,
          returnToUser: true
        });
      }
      leaf.answer_text = finalAnswer;
      delete leaf.needs_review;
      delete leaf.review_reasons;
    }

    const needs_review_count = listLeaves(tree).filter(
      (l) => l.needs_review
    ).length;
    const now = Date.now();
    const nextStatus =
      data.status === ARS_MENU_STATUS.PUBLISHED ||
      data.status === ARS_MENU_STATUS.STALE
        ? ARS_MENU_STATUS.DRAFT
        : data.status === ARS_MENU_STATUS.FAILED
          ? ARS_MENU_STATUS.DRAFT
          : data.status || ARS_MENU_STATUS.DRAFT;

    const tree_gcs_path = await saveArsJson({
      tenantId: tenant,
      datasetId: dataset_id,
      kind: "draft_tree",
      jobId: randomUUID(),
      data: tree
    });

    await commitArsDraft({
      tenantId: tenant,
      datasetId: dataset_id,
      expected: data,
      menuPatch: {
        status: nextStatus,
        tree_gcs_path,
        updated_at: now,
        tree: FieldValue.delete(),
        grouping_meta: {
          ...(data.grouping_meta || {}),
          needs_review_count
        }
      },
      datasetPatch: {
        status: nextStatus,
        tree_gcs_path,
        updated_at: now
      }
    });

    return {
      success: true,
      dataset_id,
      path_keys,
      status: nextStatus,
      needs_review_count,
      tree_gcs_path,
      leaf: {
        key: leaf.key,
        label: leaf.label,
        answer_text: leaf.answer_text || "",
        needs_review: !!leaf.needs_review,
        answer_candidates: Array.isArray(leaf.answer_candidates)
          ? leaf.answer_candidates
          : []
      }
    };
  }
});
