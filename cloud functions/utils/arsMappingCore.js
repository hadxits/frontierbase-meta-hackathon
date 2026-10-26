/**
 * ARS mapping pipeline: load JSONL → label → tree → leaf ments → GCS + Firestore meta.
 */
const { store } = require("@/firebase");
const { FieldValue } = require("firebase-admin/firestore");
const Collection = require("@/const/firestore/Collection");
const { ARS_MENU_STATUS } = require("@/const/ArsMenuStatus");
const {
  getLastFullJsonlPath,
  loadJsonlRowsFromGs,
  saveArsJson,
  loadDraftTree,
  loadPublishedTree,
  loadRowLabels
} = require("@/utils/arsGcs");
const {
  assembleArsTree,
  listLeaves,
  labelHintFromText,
  inferSectionFieldKeys,
  fieldValueFromRow
} = require("@/utils/arsGrouping");
const { labelRowsBatch, generateLeafAnswer, BATCH_SIZE } = require("@/utils/arsLlm");
const { logInfo, logAndCaptureError } = require("@/utils/logger");

function menuRef(tenantId, datasetId) {
  return store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.ARS_MENUS)
    .doc(datasetId);
}

function datasetRef(tenantId, datasetId) {
  return store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.DATASETS)
    .doc(datasetId);
}

/**
 * Update ARS progress.
 * - Always write ars_menus (live progress for PgArs / detailed view).
 * - Mirror onto dataset.ars only when `status` changes (upload-style:
 *   status + ETA on the list row, not per-tick progress that spams history).
 */
async function patchProgress(tenantId, datasetId, patch) {
  const now = Date.now();
  const arsPatch = { ...patch, updated_at: now };
  const writes = [menuRef(tenantId, datasetId).set(arsPatch, { merge: true })];
  if (Object.prototype.hasOwnProperty.call(patch, "status")) {
    writes.push(
      datasetRef(tenantId, datasetId).set(
        { ars: { ...arsPatch, menu_id: datasetId }, updated_at: now },
        { merge: true }
      )
    );
  }
  await Promise.all(writes);
}

function estimateSeconds(rowCount, forceFull) {
  const rows = Math.max(1, Number(rowCount) || 1);
  const labelBatches = Math.ceil(rows / BATCH_SIZE);
  const leafGuess = forceFull ? Math.ceil(rows / 8) : Math.ceil(rows / 20);
  return Math.max(60, labelBatches * 8 + leafGuess * 6 + 30);
}

/**
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.datasetId
 * @param {boolean} [opts.forceFull]
 * @param {string[]} [opts.changedRowIds] - if empty and not forceFull, still full when no prior tree
 */
async function runArsMappingJob({
  tenantId,
  datasetId,
  forceFull = false,
  changedRowIds = null
}) {
  const dsSnap = await datasetRef(tenantId, datasetId).get();
  if (!dsSnap.exists) {
    throw new Error(`Dataset not found: ${datasetId}`);
  }
  const datasetData = dsSnap.data() || {};
  const jsonlPath = getLastFullJsonlPath(datasetData);
  if (!jsonlPath) {
    throw new Error("Dataset has no jsonl_paths");
  }

  const prevMenuSnap = await menuRef(tenantId, datasetId).get();
  const prevMenu = prevMenuSnap.exists ? prevMenuSnap.data() || {} : {};
  const publishedTree = await loadPublishedTree(prevMenu);
  const prevDraftTree = (await loadDraftTree(prevMenu)) || publishedTree;
  const prevRowLabels = await loadRowLabels(prevMenu);

  const rows = await loadJsonlRowsFromGs(jsonlPath);
  const eta = estimateSeconds(rows.length, forceFull);
  const startedAt = Date.now();

  logInfo("[arsMapping] job start", {
    tenant_id: tenantId,
    function_name: "runArsMappingJob",
    extra: {
      step: "job_start",
      dataset_id: datasetId,
      rows_total: rows.length,
      force_full: !!forceFull,
      changed_row_ids: Array.isArray(changedRowIds) ? changedRowIds.length : 0,
      has_prev_draft: Boolean(prevDraftTree),
      has_prev_labels: Array.isArray(prevRowLabels) && prevRowLabels.length > 0,
      eta_seconds: eta,
      label_batch_size: BATCH_SIZE
    }
  });

  // Status/ETA already set by generateArsMenu on dataset; only refresh menu progress here.
  await patchProgress(tenantId, datasetId, {
    progress: 2,
    estimated_completion_seconds: eta,
    mapping_started_at: startedAt,
    source_dataset_id: datasetId,
    source_jsonl_path: jsonlPath,
    error: FieldValue.delete()
  });

  try {
    const knownDepth1 = [];
    // collect depth1 from previous tree labels at root
    const prevRoot = Array.isArray(prevDraftTree?.children)
      ? prevDraftTree.children
      : [];
    for (const c of prevRoot) {
      if (c?.label) knownDepth1.push(String(c.label));
    }

    let rowsToLabel = rows;
    const incremental =
      !forceFull &&
      prevDraftTree &&
      Array.isArray(changedRowIds) &&
      changedRowIds.length > 0;

    if (incremental) {
      const set = new Set(changedRowIds);
      rowsToLabel = rows.filter((r) => set.has(r.rowId));
    }

    const labelBatchTotal = Math.max(1, Math.ceil(rowsToLabel.length / BATCH_SIZE));
    logInfo("[arsMapping] Pass A labeling", {
      tenant_id: tenantId,
      function_name: "runArsMappingJob",
      extra: {
        step: "pass_a_start",
        dataset_id: datasetId,
        mode: incremental ? "incremental" : "full",
        rows_total: rows.length,
        rows_to_label: rowsToLabel.length,
        batch_size: BATCH_SIZE,
        batch_total: labelBatchTotal,
        known_depth1_count: knownDepth1.length
      }
    });

    await patchProgress(tenantId, datasetId, { progress: 5 });

    const { categoryKey: inferredCategoryKey } = inferSectionFieldKeys(rows);

    const labeledNew = await labelRowsBatch({
      tenantId,
      rows: rowsToLabel,
      knownDepth1,
      onProgress: async (p) => {
        await patchProgress(tenantId, datasetId, { progress: p });
      }
    });

    // For incremental: keep previous depth labels for unchanged rows; text always from JSONL.
    let allLabeled = labeledNew;
    if (incremental && Array.isArray(prevRowLabels)) {
      const byId = new Map(prevRowLabels.map((r) => [r.rowId, r]));
      for (const r of labeledNew) byId.set(r.rowId, r);
      // drop deleted
      const live = new Set(rows.map((r) => r.rowId));
      allLabeled = [...byId.values()].filter((r) => live.has(r.rowId));
      // unlabeled live rows (shouldn't happen often)
      for (const r of rows) {
        if (!byId.has(r.rowId)) {
          allLabeled.push({
            rowId: r.rowId,
            text: r.text,
            depth1:
              fieldValueFromRow(r, inferredCategoryKey) ||
              labelHintFromText(r.text) ||
              labelHintFromText(r.rowId) ||
              "#"
          });
        }
      }
    } else {
      // ensure all rows labeled on full run
      const labeledIds = new Set(labeledNew.map((r) => r.rowId));
      for (const r of rows) {
        if (!labeledIds.has(r.rowId)) {
          labeledNew.push({
            rowId: r.rowId,
            text: r.text,
            depth1:
              fieldValueFromRow(r, inferredCategoryKey) ||
              labelHintFromText(r.text) ||
              labelHintFromText(r.rowId) ||
              "#"
          });
        }
      }
      allLabeled = labeledNew;
    }

    // Rehydrate FAQ source text from full JSONL onto every label entry.
    // row_labels stores depth only; SoT for text is always JSONL.
    const textByRowId = new Map(rows.map((r) => [r.rowId, r.text]));
    allLabeled = allLabeled.map((r) => ({
      ...r,
      text: textByRowId.get(r.rowId) ?? r.text ?? ""
    }));

    await patchProgress(tenantId, datasetId, { progress: 58 });

    logInfo("[arsMapping] Pass B assemble tree", {
      tenant_id: tenantId,
      function_name: "runArsMappingJob",
      extra: {
        step: "pass_b_assemble",
        dataset_id: datasetId,
        labeled_count: allLabeled.length,
        note: "deterministic grouping; overflow deepens (no catch-all bucket)"
      }
    });

    const { tree } = assembleArsTree(allLabeled);
    const leaves = listLeaves(tree);

    // Preserve answer_text from previous leaves when source_row_ids unchanged
    const prevLeafByKey = new Map();
    if (prevDraftTree) {
      for (const leaf of listLeaves(prevDraftTree)) {
        const k = (leaf.source_row_ids || []).slice().sort().join("|");
        if (k) prevLeafByKey.set(k, leaf);
      }
    }

    const changedSet = new Set(changedRowIds || []);
    let done = 0;
    let regenerated = 0;
    let reused = 0;

    logInfo("[arsMapping] Pass C leaf ments", {
      tenant_id: tenantId,
      function_name: "runArsMappingJob",
      extra: {
        step: "pass_c_start",
        dataset_id: datasetId,
        leaf_total: leaves.length,
        note: "per-leaf LLM for spoken answers (not 100-batch)"
      }
    });

    for (const leaf of leaves) {
      const k = (leaf.source_row_ids || []).slice().sort().join("|");
      const prev = k ? prevLeafByKey.get(k) : null;
      const mustRegen =
        forceFull ||
        !prev?.answer_text ||
        (incremental &&
          (leaf.source_row_ids || []).some((id) => changedSet.has(id)));

      done += 1;
      if (!mustRegen && prev?.answer_text) {
        leaf.answer_text = prev.answer_text;
        leaf.needs_review = prev.needs_review;
        delete leaf.answer_candidates;
        reused += 1;
        if (done === leaves.length || done % 10 === 0) {
          logInfo("[arsMapping] Pass C leaf progress", {
            tenant_id: tenantId,
            function_name: "runArsMappingJob",
            extra: {
              step: "pass_c_progress",
              dataset_id: datasetId,
              leaf_index: done,
              leaf_total: leaves.length,
              regenerated,
              reused,
              last_action: "reuse_prev"
            }
          });
        }
      } else {
        // Affected leaf: load ALL dependent row texts from full JSONL, then LLM.
        const candidates = (leaf.source_row_ids || [])
          .map((id) => textByRowId.get(id))
          .filter((t) => t != null && String(t).trim() !== "");
        logInfo("[arsMapping] Pass C leaf LLM", {
          tenant_id: tenantId,
          function_name: "runArsMappingJob",
          extra: {
            step: "pass_c_leaf_llm",
            dataset_id: datasetId,
            leaf_index: done,
            leaf_total: leaves.length,
            leaf_label: leaf.label || null,
            source_row_count: candidates.length,
            key: leaf.key || null
          }
        });
        const gen = await generateLeafAnswer({
          tenantId,
          label: leaf.label,
          candidateTexts: candidates,
          meta: {
            leaf_index: done,
            leaf_total: leaves.length
          }
        });
        leaf.answer_text = gen.answer_text;
        leaf.needs_review = gen.needs_review || leaf.needs_review;
        delete leaf.answer_candidates;
        regenerated += 1;
      }
      if (done % 3 === 0 || done === leaves.length) {
        const p = 58 + Math.round((done / Math.max(1, leaves.length)) * 38);
        await patchProgress(tenantId, datasetId, { progress: Math.min(96, p) });
      }
    }

    logInfo("[arsMapping] Pass C leaf ments done", {
      tenant_id: tenantId,
      function_name: "runArsMappingJob",
      extra: {
        step: "pass_c_complete",
        dataset_id: datasetId,
        leaf_total: leaves.length,
        regenerated,
        reused
      }
    });

    const needs_review_count = leaves.filter((l) => l.needs_review).length;

    const now = Date.now();
    const rowLabelsPayload = allLabeled.map((r) => ({
      rowId: r.rowId,
      depth1: r.depth1,
      depth2: r.depth2 || null,
      depth3: r.depth3 || null
    }));

    const [tree_gcs_path, row_labels_gcs_path] = await Promise.all([
      saveArsJson({
        tenantId,
        datasetId,
        kind: "draft_tree",
        data: tree
      }),
      saveArsJson({
        tenantId,
        datasetId,
        kind: "draft_row_labels",
        data: rowLabelsPayload
      })
    ]);

    // Keep published GCS pointer; migrate inline published_tree → GCS once if needed.
    let published_tree_gcs_path = prevMenu.published_tree_gcs_path || null;
    if (!published_tree_gcs_path && publishedTree) {
      published_tree_gcs_path = await saveArsJson({
        tenantId,
        datasetId,
        kind: "published_tree",
        data: publishedTree
      });
    }

    const draftMeta = {
      status: ARS_MENU_STATUS.DRAFT,
      progress: 100,
      source_dataset_id: datasetId,
      source_jsonl_path: jsonlPath,
      source_mapped_at: now,
      mapping_started_at: startedAt,
      estimated_completion_seconds: FieldValue.delete(),
      tree_gcs_path,
      row_labels_gcs_path,
      published_tree_gcs_path: published_tree_gcs_path || FieldValue.delete(),
      // Drop legacy inline blobs so the FS doc stays under 1 MiB.
      tree: FieldValue.delete(),
      row_labels: FieldValue.delete(),
      published_tree: FieldValue.delete(),
      grouping_meta: {
        row_count: rows.length,
        leaf_count: leaves.length,
        needs_review_count,
        force_full: !!forceFull,
        incremental: !!incremental
      },
      updated_at: now,
      error: FieldValue.delete()
    };

    if (prevMenu.published_at) {
      draftMeta.published_at = prevMenu.published_at;
    }

    await menuRef(tenantId, datasetId).set(draftMeta, { merge: true });
    await datasetRef(tenantId, datasetId).set(
      {
        ars: {
          status: ARS_MENU_STATUS.DRAFT,
          progress: 100,
          last_mapped_at: now,
          last_mapped_jsonl_path: jsonlPath,
          menu_id: datasetId,
          tree_gcs_path,
          updated_at: now
        },
        updated_at: now
      },
      { merge: true }
    );

    logInfo("[arsMapping] draft ready", {
      tenant_id: tenantId,
      function_name: "runArsMappingJob",
      extra: {
        step: "draft_ready",
        dataset_id: datasetId,
        leaves: leaves.length,
        rows: rows.length,
        regenerated,
        reused,
        needs_review_count,
        tree_gcs_path,
        row_labels_gcs_path,
        elapsed_ms: Date.now() - startedAt
      }
    });

    return { ok: true, leaf_count: leaves.length, needs_review_count };
  } catch (err) {
    logAndCaptureError(
      err instanceof Error ? err : new Error(String(err)),
      "[arsMapping] job failed",
      {
        tenant_id: tenantId,
        function_name: "runArsMappingJob",
        extra: { dataset_id: datasetId }
      }
    );
    await patchProgress(tenantId, datasetId, {
      status: ARS_MENU_STATUS.FAILED,
      progress: 0,
      error: String(err?.message || err)
    });
    throw err;
  }
}

module.exports = {
  runArsMappingJob,
  estimateSeconds,
  menuRef,
  datasetRef,
  patchProgress
};
