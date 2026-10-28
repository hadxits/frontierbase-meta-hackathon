/**
 * generateArsMenu — console: enqueue ARS remapping for one dataset.
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { store } = require("@/firebase");
const { loadAndValidateTenant } = require("@/utils/tenant");
const { enqueueArsMappingTask } = require("@/utils/cloudTasks");
const {
  getLastFullJsonlPath,
  loadJsonlRowsFromGs,
  hasDraftTree
} = require("@/utils/arsGcs");
const {
  estimateSeconds,
  menuRef,
  datasetRef,
  patchProgress
} = require("@/utils/arsMappingCore");
const {
  ARS_MENU_STATUS,
  isArsProcessingStatus
} = require("@/const/ArsMenuStatus");
const { logInfo, logWarn } = require("@/utils/logger");

module.exports = _onRequest({
  opts: {
    memory: "1GiB",
    timeoutSeconds: 540,
    maxInstances: 4,
    concurrency: 5
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      dataset_id: { type: PropertyType.STRING },
      force_full: { type: PropertyType.BOOLEAN },
      locale: { type: PropertyType.STRING }
    },
    required: ["tenant", "dataset_id"]
  },
  handler: async (req) => {
    const tenant = String(req.body.tenant || "").trim();
    const dataset_id = String(req.body.dataset_id || "").trim();
    // Mutable: old JSONL missing/unreadable → full, same as uploadDataset (oldRows=[] → full ingest).
    let forceFull = req.body.force_full === true;
    const locale = String(req.body.locale || "en").trim() || "en";

    await loadAndValidateTenant(tenant, {
      locale,
      functionName: "generateArsMenu",
      requireQdrantUrl: false
    });

    const dsRef = datasetRef(tenant, dataset_id);
    const dsSnap = await dsRef.get();
    if (!dsSnap.exists) {
      throw new ApiError({
        errorCode: "NOT_FOUND",
        message: "Dataset not found",
        httpStatusCode: 404,
        returnToUser: true
      });
    }
    const datasetData = dsSnap.data() || {};
    const status = String(datasetData.status || "").toLowerCase();
    if (status !== "ready") {
      throw new ApiError({
        errorCode: "DATASET_NOT_READY",
        message: "Dataset must be ready before ARS mapping",
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const jsonlPath = getLastFullJsonlPath(datasetData);
    if (!jsonlPath) {
      throw new ApiError({
        errorCode: "NO_JSONL",
        message: "Dataset has no JSONL snapshot",
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const prevMenu = (await menuRef(tenant, dataset_id).get()).data() || {};
    if (
      isArsProcessingStatus(prevMenu.status) ||
      isArsProcessingStatus(datasetData.ars?.status)
    ) {
      throw new ApiError({
        errorCode: "ARS_ALREADY_PROCESSING",
        message: "ARS mapping already in progress",
        httpStatusCode: 409,
        returnToUser: true
      });
    }
    if (!hasDraftTree(prevMenu) || prevMenu.engine === "muse") forceFull = true;

    const prevPath = String(prevMenu.source_jsonl_path || "").trim();
    let changed_row_ids = null;
    // Diff is local to this endpoint (uploadDataset has its own row diff). Same policy:
    // old snapshot unreadable → full; new snapshot failure → hard error.
    if (!forceFull && prevPath && prevPath !== jsonlPath) {
      let oldRows = null;
      try {
        oldRows = await loadJsonlRowsFromGs(prevPath);
      } catch (e) {
        logWarn("[generateArsMenu] Old JSONL load failed; full remap", {
          tenant_id: tenant,
          function_name: "generateArsMenu",
          extra: {
            prev_path: prevPath,
            error: e?.message || String(e)
          }
        });
        forceFull = true;
      }

      if (!forceFull && oldRows) {
        let newRows;
        try {
          newRows = await loadJsonlRowsFromGs(jsonlPath);
        } catch (e) {
          throw new ApiError({
            errorCode: "JSONL_LOAD_FAILED",
            message: e?.message || "Failed to load current dataset JSONL",
            httpStatusCode: 400,
            returnToUser: true
          });
        }
        const oldMap = new Map(oldRows.map((r) => [r.rowId, r.text]));
        const newMap = new Map(newRows.map((r) => [r.rowId, r.text]));
        const changed = [];
        for (const [id, text] of newMap) {
          if (!oldMap.has(id) || oldMap.get(id) !== text) changed.push(id);
        }
        for (const id of oldMap.keys()) {
          if (!newMap.has(id)) changed.push(id);
        }
        changed_row_ids = [...new Set(changed)];
      }
    }

    if (forceFull) changed_row_ids = null;

    const rowCount = Number(
      datasetData.rows || datasetData.record_count || 100
    );
    const eta = estimateSeconds(rowCount, forceFull);
    const now = Date.now();
    const mappingState = {
      job_id: `ars-${dataset_id}-${now}`,
      engine: "legacy",
      model: null,
      report_gcs_path: null,
      usage: null,
      status: ARS_MENU_STATUS.PROCESSING,
      progress: 1,
      estimated_completion_seconds: eta,
      mapping_started_at: now,
      source_dataset_id: dataset_id,
      source_jsonl_path: jsonlPath,
      updated_at: now,
      error: null
    };
    await store.runTransaction(async (tx) => {
      const ref = menuRef(tenant, dataset_id);
      const [current, source] = await Promise.all([tx.get(ref), tx.get(dsRef)]);
      if (!source.exists || source.data().status !== "ready" ||
          getLastFullJsonlPath(source.data()) !== jsonlPath) {
        throw new ApiError({
          errorCode: "DATASET_CHANGED", message: "Dataset changed; generate again",
          httpStatusCode: 409, returnToUser: true
        });
      }
      if (isArsProcessingStatus(current.data()?.status) ||
          isArsProcessingStatus(source.data().ars?.status)) {
        throw new ApiError({
          errorCode: "ARS_ALREADY_PROCESSING", message: "ARS mapping already in progress",
          httpStatusCode: 409, returnToUser: true
        });
      }
      tx.set(ref, mappingState, { merge: true });
      tx.set(dsRef,
        { ars: { ...mappingState, menu_id: dataset_id }, updated_at: now },
        { merge: true }
      );
    });

    try {
      await enqueueArsMappingTask({
        tenant,
        dataset: dataset_id,
        force_full: forceFull,
        changed_row_ids,
        job_id: mappingState.job_id
      });
    } catch (enqErr) {
      await patchProgress(tenant, dataset_id, {
        status: ARS_MENU_STATUS.FAILED,
        progress: 0,
        error: enqErr?.message || String(enqErr)
      }, mappingState.job_id);
      throw new ApiError({
        errorCode: "ARS_ENQUEUE_FAILED",
        message: enqErr?.message || "Failed to enqueue ARS mapping task",
        httpStatusCode: 500,
        returnToUser: true
      });
    }
    logInfo("[generateArsMenu] enqueued", {
      tenant_id: tenant,
      function_name: "generateArsMenu",
      extra: { dataset_id, eta, force_full: forceFull }
    });

    return {
      success: true,
      dataset_id,
      status: ARS_MENU_STATUS.PROCESSING,
      estimated_completion_seconds: eta,
      mapping_started_at: now
    };
  }
});
