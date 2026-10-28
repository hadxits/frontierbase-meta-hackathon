const { store } = require("@/firebase");
const ApiError = require("@/errors/apiError");
const { menuRef, datasetRef } = require("@/utils/arsMappingCore");

// Another edit or generation can start while files are uploading.
// Update file pointers and status only if the draft we read is still current.
async function commitArsDraft({ tenantId, datasetId, expected, menuPatch, datasetPatch }) {
  await store.runTransaction(async (tx) => {
    const ref = menuRef(tenantId, datasetId);
    const ds = datasetRef(tenantId, datasetId);
    const [menu, dataset] = await Promise.all([tx.get(ref), tx.get(ds)]);
    const current = menu.data();
    if (
      !menu.exists ||
      !dataset.exists ||
      dataset.data().status !== "ready" ||
      current.status !== expected.status ||
      (current.job_id || null) !== (expected.job_id || null) ||
      (current.tree_gcs_path || null) !== (expected.tree_gcs_path || null)
    ) {
      throw new ApiError({
        errorCode: "ARS_DRAFT_CHANGED",
        message: "ARS draft or dataset changed; reload before saving",
        httpStatusCode: 409,
        returnToUser: true
      });
    }
    tx.set(ref, menuPatch, { merge: true });
    tx.set(
      ds,
      {
        ars: { ...datasetPatch, menu_id: datasetId },
        updated_at: menuPatch.updated_at
      },
      { merge: true }
    );
  });
}

module.exports = { commitArsDraft };
