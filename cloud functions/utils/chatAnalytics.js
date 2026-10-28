/**
 * ============================================================================
 * chatAnalytics.js - chat analysis aggregation (by question type, row hit, cluster)
 * ============================================================================
 *
 * 1. Count by question type: tenants/{tenantId}/analytics_question_type_daily/{dateKey}
 * 2. Aggregation by hit row_id + jsonl_path: tenants/{tenantId}/analytics_row_hits (doc per dateKey_datasetId_rowId)
 * 3. Cluster master: divide by question type, compare with dynamic clusters (DB) at similarity 0.85
 *    - If similarity with existing cluster centroid >= 0.85, use that id; otherwise create new cluster
 *    - tenants/{tenantId}/analytics_cluster_master/{clusterId}: question_type, centroid, representative_question (when creating new cluster)
 *    - Daily question type counts are recorded only in analytics_question_type_daily (analytics_cluster_daily not used)
 * ============================================================================
 */
const crypto = require("crypto");
const { store, storage } = require("@/firebase");
const { FieldValue } = require("firebase-admin/firestore");
const Collection = require("@/const/firestore/Collection");
const { cosineSimilarity } = require("@/utils/cache");
const { logWarn } = require("@/utils/logger");
const { toUtcDateKey } = require("@/utils/utcDateKey");

const SIMILARITY_THRESHOLD = 0.85;

/** cluster_id used when question embedding is missing (cannot create cluster) */
const CLUSTER_OTHER = "other";

/** Maximum character count when saving representative question (for Firestore field) */
const REPRESENTATIVE_QUESTION_MAX_CHARS = 500;

const DEFAULT_GCS_BUCKET =
  process.env.GCS_BUCKET || "frontierbase-console.firebasestorage.app";

/**
 * Dynamic cluster: compare similarity with existing clusters (DB), if >= 0.85 use that id, else create new cluster and return its id.
 * When creating new cluster, save user question as representative_question.
 * @param {string} tenantId
 * @param {string} questionType
 * @param {number[]} queryVector - embedding of user question (same as for RAG search)
 * @param {string} [representativeQuestion] - original user question (saved as representative question when creating new cluster)
 * @returns {Promise<string>} cluster_id (Firestore doc id or CLUSTER_OTHER)
 */
async function getClusterId(tenantId, questionType, queryVector, representativeQuestion) {
  if (!tenantId || !queryVector || !Array.isArray(queryVector) || queryVector.length === 0) {
    return CLUSTER_OTHER;
  }
  const safeType =
    questionType != null && String(questionType).trim() !== ""
      ? String(questionType).trim()
      : "unknown";

  const col = store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.ANALYTICS_CLUSTER_MASTER);

  const snapshot = await col.where("question_type", "==", safeType).get();
  let maxSim = -1;
  let bestId = null;

  snapshot.docs.forEach((doc) => {
    const centroid = doc.data().centroid;
    if (!Array.isArray(centroid) || centroid.length !== queryVector.length) return;
    const sim = cosineSimilarity(queryVector, centroid);
    if (sim >= SIMILARITY_THRESHOLD && sim > maxSim) {
      maxSim = sim;
      bestId = doc.id;
    }
  });

  if (bestId != null) {
    return bestId;
  }

  const newRef = col.doc();
  const payload = {
    question_type: safeType,
    centroid: queryVector,
    created_at: FieldValue.serverTimestamp()
  };
  if (representativeQuestion != null && String(representativeQuestion).trim()) {
    payload.representative_question = String(representativeQuestion)
      .trim()
      .slice(0, REPRESENTATIVE_QUESTION_MAX_CHARS);
  }
  await newRef.set(payload);
  return newRef.id;
}

/**
 * Generate date key (YYYY-MM-DD)
 * @param {FirebaseFirestore.Timestamp|number|Date} timestamp - milliseconds, Firestore Timestamp, or Date
 * @returns {string}
 */
function toDateKey(timestamp) {
  let ms = Date.now();
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    ms = timestamp;
  } else if (timestamp && typeof timestamp.toMillis === "function") {
    ms = timestamp.toMillis();
  } else if (timestamp && Number.isFinite(timestamp?.seconds)) {
    ms = timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1e6;
  } else if (timestamp instanceof Date) {
    ms = timestamp.getTime();
  }
  return toUtcDateKey(ms);
}

/**
 * 1. Increment daily count by question type
 * If questionType is missing, record as "unknown"
 */
async function recordQuestionTypeDaily(tenantId, dateKey, questionType) {
  if (!tenantId || !dateKey) return;
  const ref = store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.ANALYTICS_QUESTION_TYPE_DAILY)
    .doc(dateKey);
  const safeType =
    questionType != null && String(questionType).trim() !== ""
      ? String(questionType).trim()
      : "unknown";
  await ref.set(
    {
      date_key: dateKey,
      tenant_id: tenantId,
      [safeType]: FieldValue.increment(1),
      updated_at: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

/**
 * 2. Aggregate by hit row_id (daily) + save jsonl_path
 * Hit count per request is usually small (below MAX_CONTEXT_CHUNKS), so batch limit of 500 is not exceeded.
 * @param {string} tenantId
 * @param {string} dateKey
 * @param {Array<{ dataset_id: string, row_id: string, jsonl_path: string|null }>} hits
 */
async function recordRowHits(tenantId, dateKey, hits) {
  if (!tenantId || !dateKey || !Array.isArray(hits) || hits.length === 0) return;
  const col = store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.ANALYTICS_ROW_HITS);

  const byKey = new Map();
  for (const h of hits) {
    const did = String(h?.dataset_id ?? "").trim();
    const rid = String(h?.row_id ?? "").trim();
    if (!did || !rid) continue;
    const key = `${dateKey}_${did}_${rid}`;
    if (!byKey.has(key)) {
      byKey.set(key, { dataset_id: did, row_id: rid, jsonl_path: h?.jsonl_path ?? null, count: 0 });
    }
    byKey.get(key).count += 1;
    if (h?.jsonl_path) byKey.get(key).jsonl_path = h.jsonl_path;
  }

  const batch = store.batch();
  for (const [, v] of byKey) {
    const docId = crypto.createHash("sha256").update(`${dateKey}_${v.dataset_id}_${v.row_id}`).digest("hex").slice(0, 50);
    const docRef = col.doc(docId);
    const update = {
      date_key: dateKey,
      dataset_id: v.dataset_id,
      row_id: v.row_id,
      hit_count: FieldValue.increment(v.count),
      updated_at: FieldValue.serverTimestamp()
    };
    if (v.jsonl_path != null) {
      update.jsonl_path = v.jsonl_path;
    }
    batch.set(docRef, update, { merge: true });
  }
  await batch.commit();
}

/**
 * Record analysis for one chat request (async call recommended, log only on failure)
 * @param {Object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.dateKey - YYYY-MM-DD
 * @param {string} opts.questionType - lookup | comparison | explanation | action | unknown
 * @param {number[]} opts.queryVector - user question embedding (same as RAG search, used for cluster matching/creation)
 * @param {Array<{ dataset_id: string, row_id: string, jsonl_path?: string }>} opts.rowHits - list of rows hit by RAG
 * @param {string} [opts.representativeQuestion] - original user question (saved as representative question when creating new cluster)
 */
async function recordChatAnalytics(opts) {
  const { tenantId, dateKey, questionType, queryVector, rowHits, representativeQuestion } = opts || {};
  if (!tenantId || !dateKey) return;

  const safeQuestionType =
    questionType != null && String(questionType).trim() !== ""
      ? String(questionType).trim()
      : "unknown";

  try {
    await recordQuestionTypeDaily(tenantId, dateKey, safeQuestionType);

    if (Array.isArray(rowHits) && rowHits.length > 0) {
      await recordRowHits(tenantId, dateKey, rowHits);
    }

    if (queryVector && queryVector.length > 0) {
      await getClusterId(
        tenantId,
        safeQuestionType,
        queryVector,
        representativeQuestion
      );
    }
  } catch (err) {
    logWarn("[chatAnalytics] recordChatAnalytics failed", {
      tenant_id: tenantId,
      function_name: "recordChatAnalytics",
      extra: { error: err?.message || String(err) }
    });
  }
}

/** streamChatRag EVIDENCE_CANDIDATES_CAP / Qdrant topK limit */
const MAX_RETRIEVAL_HITS = 50;

function extractHitTextFromPayload(payload) {
  if (typeof payload?.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }
  if (typeof payload?.embedding_text === "string" && payload.embedding_text.trim()) {
    return payload.embedding_text.trim();
  }
  return null;
}

function hitToEvidenceObject(hit) {
  return {
    row_id: hit.row_id,
    dataset_id: hit.dataset_id,
    text: hit.text != null ? String(hit.text) : "",
    version: hit.version || 1,
    score: hit.score ?? null
  };
}

function buildUnansweredEvidenceJson(hits) {
  return JSON.stringify(
    (Array.isArray(hits) ? hits : []).map(hitToEvidenceObject),
    null,
    2
  );
}

/**
 * Only Qdrant retrieval hits are saved as GCS evidence.json (for analysis API signed URL + file_url)
 * @returns {Promise<string|null>} gs:// path
 */
async function uploadUnansweredEvidenceJson(tenantId, docId, hits) {
  const rows = Array.isArray(hits) ? hits : [];
  if (!tenantId || !docId || rows.length === 0) return null;

  const objectPath = `analytics_unanswered/${tenantId}/${docId}/evidence.json`;
  const content = buildUnansweredEvidenceJson(rows);
  const file = storage.bucket(DEFAULT_GCS_BUCKET).file(objectPath);
  await file.save(content, {
    metadata: {
      contentType: "application/json",
      metadata: {
        tenant_id: tenantId,
        analytics_unanswered_id: docId,
        type: "unanswered_evidence",
        row_count: String(rows.length)
      }
    }
  });
  return `gs://${DEFAULT_GCS_BUCKET}/${objectPath}`;
}

async function uploadUnansweredEvidenceJsonWithRetry(tenantId, docId, hits) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await uploadUnansweredEvidenceJson(tenantId, docId, hits);
    } catch (err) {
      lastErr = err;
      if (attempt === 1) {
        logWarn("[chatAnalytics] uploadUnansweredEvidenceJson failed, retrying once", {
          tenant_id: tenantId,
          function_name: "recordUnansweredQuestion",
          extra: {
            analytics_unanswered_id: docId,
            error: err?.message || String(err)
          }
        });
      }
    }
  }
  throw lastErr;
}

/**
 * Collect all hits returned by Qdrant search sorted by descending score (remove duplicate rows, limit 50)
 * @param {...Array} sources - Qdrant result arrays like allResults, expandedResults, filteredResults
 * @returns {Array<{ dataset_id: string, row_id: string, version: number|null, score: number|null, text: string|null }>}
 */
function collectUnansweredEvidenceHits(...sources) {
  const byKey = new Map();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      if (item == null || typeof item !== "object" || !item.payload) continue;
      const payload = item.payload;
      const datasetId = String(
        payload.dataset ?? payload.dataset_id ?? payload.datasetId ?? ""
      ).trim();
      const rowId = String(payload.row_id ?? payload.rowId ?? "").trim();
      if (!datasetId || !rowId) continue;
      const key = `${datasetId}:${rowId}`;
      const score = Number.isFinite(item.score) ? item.score : null;
      const existing = byKey.get(key);
      if (existing != null) {
        const existingScore = existing.score;
        if (
          existingScore != null &&
          (score == null || score <= existingScore)
        ) {
          continue;
        }
      }
      const parsedVersion = Number(payload.version);
      byKey.set(key, {
        dataset_id: datasetId,
        row_id: rowId,
        version:
          parsedVersion > 0 && Number.isInteger(parsedVersion)
            ? parsedVersion
            : null,
        score,
        text: extractHitTextFromPayload(payload)
      });
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => {
      const sa = a.score ?? -1;
      const sb = b.score ?? -1;
      return sb - sa;
    })
    .slice(0, MAX_RETRIEVAL_HITS);
}

/**
 * Lookup dataset Firestore → jsonl snapshot Map (for recordChatAnalytics row hit)
 * @param {string} tenantId
 * @param {string[]} datasetIds
 * @returns {Promise<Map<string, { jsonl_path: string|null, jsonl_created_at: number|null, dataset_name: string|null }>>}
 */
async function resolveUnansweredDatasetContexts(tenantId, datasetIds) {
  const ids = Array.isArray(datasetIds) ? datasetIds.slice(0, 30) : [];
  if (!tenantId || ids.length === 0) return [];

  return Promise.all(
    ids.map(async (datasetId) => {
      const base = {
        dataset_id: datasetId,
        jsonl_path: null,
        jsonl_created_at: null,
        dataset_name: null
      };
      try {
        const snap = await store
          .collection(Collection.TENANTS)
          .doc(tenantId)
          .collection(Collection.DATASETS)
          .doc(datasetId)
          .get();
        if (!snap.exists) return base;
        const data = snap.data() || {};
        base.dataset_name =
          data.name != null ? String(data.name).trim() || null : null;
        const paths = Array.isArray(data.jsonl_paths) ? data.jsonl_paths : [];
        if (paths.length === 0) return base;
        const last = paths[paths.length - 1];
        base.jsonl_path =
          last?.gcs_path != null ? String(last.gcs_path).trim() || null : null;
        const createdAt = Number(last?.created_at);
        base.jsonl_created_at = Number.isFinite(createdAt) ? createdAt : null;
        return base;
      } catch (err) {
        logWarn("[chatAnalytics] resolveUnansweredDatasetContexts failed", {
          tenant_id: tenantId,
          function_name: "resolveUnansweredDatasetContexts",
          extra: {
            dataset_id: datasetId,
            error: err?.message || String(err)
          }
        });
        return base;
      }
    })
  );
}

async function loadJsonlPathByDatasetMap(tenantId, datasetIds) {
  const contexts = await resolveUnansweredDatasetContexts(tenantId, datasetIds);
  const map = new Map();
  for (const ctx of contexts) {
    map.set(ctx.dataset_id, {
      jsonl_path: ctx.jsonl_path,
      jsonl_created_at: ctx.jsonl_created_at,
      dataset_name: ctx.dataset_name
    });
  }
  return map;
}

/**
 * Record turns without exact KB answers like unanswered or insufficient evidence in analytics_unanswered (excluding clarifications)
 * The full Qdrant hit row is stored only in GCS evidence.json. Firestore records only the path and retrieval_hit_count.
 * @param {Object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.conversationId
 * @param {string} opts.question
 * @param {string} opts.assistantResponse
 * @param {string} opts.ragResultType - abstain | no_result | no_datasets | empty_context (clarify excludes unanswered counts)
 * @param {string} [opts.questionType]
 * @param {string} [opts.locale]
 * @param {string} [opts.userMessageId]
 * @param {string} [opts.assistantMessageId]
 * @param {Array[]} [opts.ragSources] - Array of Qdrant result[] (multiple)
 */
async function recordUnansweredQuestion(opts) {
  const {
    tenantId,
    conversationId,
    question,
    assistantResponse,
    ragResultType,
    questionType = "unknown",
    locale = null,
    userMessageId = null,
    assistantMessageId = null,
    ragSources = null
  } = opts || {};

  const safeType = String(ragResultType || "").trim();
  if (!tenantId || !conversationId || !safeType) return;
  if (safeType === "clarify") return;

  const sourceArrays = [];
  if (Array.isArray(ragSources)) {
    for (const src of ragSources) {
      if (Array.isArray(src)) sourceArrays.push(src);
    }
  }

  const evidenceHitsRaw = collectUnansweredEvidenceHits(...sourceArrays);
  const retrievalHitCount = evidenceHitsRaw.length;
  const hitDatasetIds = [
    ...new Set(evidenceHitsRaw.map((h) => h.dataset_id).filter(Boolean))
  ];

  const questionSafe = String(question || "").trim().slice(0, 2000);
  const assistantSafe = String(assistantResponse || "").trim().slice(0, 4000);
  const questionTypeSafe =
    questionType != null && String(questionType).trim() !== ""
      ? String(questionType).trim()
      : "unknown";

  const ref = store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.ANALYTICS_UNANSWERED)
    .doc();

  let evidenceGcsPath = null;
  let retrievalHitCountToStore = retrievalHitCount;

  const nowMs = Date.now();

  if (evidenceHitsRaw.length > 0) {
    try {
      evidenceGcsPath = await uploadUnansweredEvidenceJsonWithRetry(
        tenantId,
        ref.id,
        evidenceHitsRaw
      );
    } catch (err) {
      logWarn(
        "[chatAnalytics] uploadUnansweredEvidenceJson failed after retry; storing turn without evidence snapshot",
        {
          tenant_id: tenantId,
          function_name: "recordUnansweredQuestion",
          extra: {
            analytics_unanswered_id: ref.id,
            intended_retrieval_hit_count: retrievalHitCount,
            error: err?.message || String(err)
          }
        }
      );
      evidenceGcsPath = null;
      retrievalHitCountToStore = 0;
    }
  }

  const payload = {
    tenant_id: tenantId,
    conversation_id: conversationId,
    question: questionSafe,
    assistant_response: assistantSafe,
    rag_result_type: safeType,
    question_type: questionTypeSafe,
    locale: locale || null,
    dataset_ids: hitDatasetIds,
    evidence_gcs_path: evidenceGcsPath,
    retrieval_hit_count: retrievalHitCountToStore,
    user_message_id: userMessageId || null,
    assistant_message_id: assistantMessageId || null,
    created_at: nowMs,
    updated_at: nowMs
  };

  try {
    await ref.set(payload);
  } catch (err) {
    logWarn("[chatAnalytics] recordUnansweredQuestion write failed", {
      tenant_id: tenantId,
      function_name: "recordUnansweredQuestion",
      extra: { error: err?.message || String(err) }
    });
  }
}

module.exports = {
  toDateKey,
  recordQuestionTypeDaily,
  recordRowHits,
  recordChatAnalytics,
  recordUnansweredQuestion,
  collectUnansweredEvidenceHits,
  loadJsonlPathByDatasetMap,
  resolveUnansweredDatasetContexts,
  getClusterId,
  CLUSTER_OTHER,
  SIMILARITY_THRESHOLD
};