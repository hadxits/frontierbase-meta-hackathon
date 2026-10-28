const ApiError = require("@/errors/apiError");
const { logInfo, logAndCaptureError } = require("@/utils/logger");
const environment = require("@/env");

// Qdrant collection naming helper (same as worker.js)
function toSafeCollectionName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

// Named vector name (same as worker)
const VECTOR_EMBEDDING = "embedding";
const VECTOR_BM25 = "bm25";

/**
 * Create sparse vector for BM25 (same logic as worker — query/document tokenization identical)
 * @param {string} text - Original text
 * @returns {{ indices: number[], values: number[] }}
 */
function textToBm25Sparse(text) {
  if (!text || typeof text !== "string") {
    return { indices: [], values: [] };
  }
  // Multilingual/mixed language tokenization:
  // - Latin (English/European): accent folding + [a-z0-9] word tokens (length >= 2)
  // - Hangul (Korean): Hangul tokens (length >= 1)
  // - CJK (Japanese/Chinese): no spaces, so use character bigrams plus short sequence tokens
  // ⚠️ Must keep identical logic with worker.js
  const MAX_TOKENS = 512; // Prevent excessive token explosion
  const MAX_CJK_NGRAMS = 384;
  const MAX_LATIN_TOKENS = 192;
  const MAX_HANGUL_TOKENS = 192;

  const nfkc = text.normalize("NFKC").toLowerCase();

  // Latin: decompose accents with NFKD and remove combining marks → fold é/ö/ñ etc.
  const latinFold = nfkc.normalize("NFKD").replace(/\p{M}+/gu, "");
  const latinTokensRaw = latinFold.match(/[a-z0-9]{2,}/g) || [];
  const latinTokens = latinTokensRaw.slice(0, MAX_LATIN_TOKENS);

  // Hangul: tokens combining Korean syllables (U+AC00-U+D7A3) with digits
  const hangulTokensRaw = nfkc.match(/[가-힣0-9]+/g) || [];
  const hangulTokens = hangulTokensRaw
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, MAX_HANGUL_TOKENS);

  // CJK sequences (hiragana/katakana/kanji/half-width katakana)
  const cjkSeqs =
    nfkc.match(
      /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff65-\uff9f]+/g
    ) || [];
  const cjkTokens = [];
  let cjkNgrams = 0;
  for (const seq of cjkSeqs) {
    const s = String(seq || "").trim();
    if (!s) continue;

    // Add short segments as tokens directly (e.g., ダッシュボード, 設定)
    if (s.length >= 2 && s.length <= 12) cjkTokens.push(s);
    if (s.length === 1) cjkTokens.push(s);

    // Character bigrams (fallback for CJK only)
    for (let i = 0; i < s.length - 1; i++) {
      cjkTokens.push(s.slice(i, i + 2));
      cjkNgrams++;
      if (cjkNgrams >= MAX_CJK_NGRAMS) break;
    }
    if (cjkNgrams >= MAX_CJK_NGRAMS) break;
  }

  const tokens = [...latinTokens, ...hangulTokens, ...cjkTokens].slice(
    0,
    MAX_TOKENS
  );
  if (tokens.length === 0) {
    return { indices: [], values: [] };
  }
  const tf = new Map();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = (h * 33 + s.charCodeAt(i)) >>> 0;
    }
    return h >>> 0;
  }
  const byIndex = new Map();
  for (const [term, count] of tf) {
    const idx = hashStr(term);
    const weight = 1 + Math.log(count);
    const prev = byIndex.get(idx) || 0;
    byIndex.set(idx, prev + weight);
  }
  const indices = [];
  const values = [];
  for (const [idx, val] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    indices.push(idx);
    values.push(val);
  }
  return { indices, values };
}

// Qdrant client helper
function makeQdrantClient(qdrantUrl, timeoutMs = 30000, tenantId = null) {
  async function qdrantFetch(path, { method = "GET", body, allowStatuses = [] } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${qdrantUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      const text = await res.text();
      if (!res.ok) {
        // Allowed status codes like collection not found (404) pass without error/log.
        if (
          Array.isArray(allowStatuses) &&
          allowStatuses.includes(res.status)
        ) {
          return { allowedStatus: res.status };
        }
        const errorMsg = `Qdrant ${method} ${path} failed: ${res.status} ${text}`;
        const error = new Error(errorMsg);
        error.status = res.status;
        error.responseBody = text;
        logAndCaptureError(error, "[streamChatRag] Qdrant request failed", {
          tenant_id: tenantId || "empty",
          function_name: "qdrantFetch",
          extra: {
            method,
            path,
            status: res.status,
            error: text
          }
        });
        throw error;
      }
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function searchPoints(
    collection,
    { vector, filter, topK, scoreThreshold = 0.4 }
  ) {
    const body = {
      // Since worker creates collections with named vectors (embedding/bm25),
      // embedding must be specified as NamedVector format even for dense-only search for stability.
      // (Depending on version, top-level `using` field may be ignored in /points/search,
      //  and sending only array vector may cause Qdrant to look for default (empty name) vector and return 400)
      vector: { name: VECTOR_EMBEDDING, vector },
      filter,
      limit: topK,
      with_payload: true
    };
    if (scoreThreshold != null && scoreThreshold > 0) {
      body.score_threshold = scoreThreshold;
    }
    return await qdrantFetch(`/collections/${collection}/points/search`, {
      method: "POST",
      body
    });
  }

  // Sparse (BM25) only search: for lexical recall enhancement in lookup/structured Q&A.
  async function searchPointsSparse(collection, { sparse, filter, topK }) {
    const indices = Array.isArray(sparse?.indices) ? sparse.indices : [];
    const values = Array.isArray(sparse?.values) ? sparse.values : [];
    const body = {
      vector: { name: VECTOR_BM25, vector: { indices, values } },
      filter,
      limit: topK,
      with_payload: true
    };
    return await qdrantFetch(`/collections/${collection}/points/search`, {
      method: "POST",
      body
    });
  }

  /**
   * Hybrid search (Query API: prefetch embedding + bm25, fusion RRF)
   * RRF scores have different cosine and scale, so score_threshold is not applied (server filter uses only filter).
   * @param {string} collection - Collection name
   * @param {object} opts - queryEmbedding, querySparse ({ indices, values }), filter, topK
   * @returns {Promise<{ result?: { points?: Array } }>}
   */
  async function queryPointsHybrid(
    collection,
    { queryEmbedding, querySparse, filter, topK }
  ) {
    const prefetchLimit = Math.max(topK * 2, 20);
    const prefetchFilter = filter || undefined;
    const body = {
      prefetch: [
        {
          query:
            querySparse?.indices?.length > 0
              ? { indices: querySparse.indices, values: querySparse.values }
              : { indices: [0], values: [0] },
          using: VECTOR_BM25,
          limit: prefetchLimit,
          ...(prefetchFilter ? { filter: prefetchFilter } : {})
        },
        {
          query: queryEmbedding,
          using: VECTOR_EMBEDDING,
          limit: prefetchLimit,
          ...(prefetchFilter ? { filter: prefetchFilter } : {})
        }
      ],
      query: { fusion: "rrf" },
      limit: topK,
      with_payload: true
    };
    if (filter) body.filter = filter;
    return await qdrantFetch(`/collections/${collection}/points/query`, {
      method: "POST",
      body
    });
  }

  return { qdrantFetch, searchPoints, searchPointsSparse, queryPointsHybrid };
}

// ✅ FIX: Remove duplicates - common Qdrant search function
// scoreThreshold: Qdrant server filters out results with score < scoreThreshold
// useSingleSearch: if true, search multiple datasets at once with match.any (when total records are under 100,000)
async function runQdrantSearch({
                                 tenant_id,
                                 targetDatasets,
                                 topK,
                                 queryVector,
                                 querySparse = null,
                                 qdrant,
                                 collection,
                                 excludedRowIds = null,
                                 scoreThreshold = 0.4,
                                 useSingleSearch = false,
                                 forceSparseOnly = false
                               }) {
  let results = [];
  const requestedTargetDatasets = Array.isArray(targetDatasets)
    ? targetDatasets.filter(Boolean)
    : [];
  const hasSparse =
    querySparse && querySparse.indices && querySparse.indices.length > 0;
  const useSparseOnly = !!forceSparseOnly && hasSparse;
  const useHybrid = !forceSparseOnly && hasSparse;
  const normalizeDatasetValue = (value) => {
    const normalized = String(value || "").trim();
    return normalized || null;
  };
  const getPayloadDatasetFields = (item) => ({
    payload_dataset: normalizeDatasetValue(item?.payload?.dataset),
    payload_dataset_id: normalizeDatasetValue(item?.payload?.dataset_id),
    payload_datasetId: normalizeDatasetValue(item?.payload?.datasetId),
    row_id: normalizeDatasetValue(item?.payload?.row_id),
    score:
      typeof item?.score === "number" && Number.isFinite(item.score)
        ? Number(item.score.toFixed(6))
        : null
  });
  const summarizeFieldDistribution = (entries = [], fieldName) => {
    const counts = new Map();
    for (const item of Array.isArray(entries) ? entries : []) {
      const value = normalizeDatasetValue(item?.payload?.[fieldName]);
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([dataset_id, count]) => ({ dataset_id, count }));
  };
  const summarizeResultDatasets = (entries = []) => {
    const counts = new Map();
    for (const item of Array.isArray(entries) ? entries : []) {
      const datasetId =
        normalizeDatasetValue(item?.payload?.dataset_id) ||
        normalizeDatasetValue(item?.payload?.datasetId) ||
        normalizeDatasetValue(item?.payload?.dataset) ||
        null;
      if (!datasetId) continue;
      counts.set(datasetId, (counts.get(datasetId) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([dataset_id, count]) => ({ dataset_id, count }));
  };
  const summarizeDatasetFieldDiagnostics = (entries = []) => {
    const mismatches = [];
    const unexpected = [];
    for (const item of Array.isArray(entries) ? entries : []) {
      const fields = getPayloadDatasetFields(item);
      const available = [
        fields.payload_dataset,
        fields.payload_dataset_id,
        fields.payload_datasetId
      ].filter(Boolean);
      const uniqueAvailable = [...new Set(available)];
      if (uniqueAvailable.length > 1 && mismatches.length < 10) {
        mismatches.push(fields);
      }
      const effectiveDataset =
        fields.payload_dataset_id ||
        fields.payload_datasetId ||
        fields.payload_dataset ||
        null;
      if (
        effectiveDataset &&
        requestedTargetDatasets.length > 0 &&
        !requestedTargetDatasets.includes(effectiveDataset) &&
        unexpected.length < 10
      ) {
        unexpected.push({
          effective_dataset: effectiveDataset,
          ...fields
        });
      }
    }
    return {
      payload_dataset_distribution: summarizeFieldDistribution(entries, "dataset").slice(0, 20),
      payload_dataset_id_distribution: summarizeFieldDistribution(entries, "dataset_id").slice(
        0,
        20
      ),
      payload_datasetId_distribution: summarizeFieldDistribution(entries, "datasetId").slice(
        0,
        20
      ),
      payload_dataset_mismatch_samples: mismatches,
      unexpected_dataset_samples: unexpected
    };
  };
  const search = (filter, k) =>
    useSparseOnly
      ? qdrant.searchPointsSparse(collection, {
        sparse: querySparse,
        filter,
        topK: k
      })
      : useHybrid
        ? qdrant.queryPointsHybrid(collection, {
          queryEmbedding: queryVector,
          querySparse,
          filter,
          topK: k
        })
        : qdrant.searchPoints(collection, {
          vector: queryVector,
          filter,
          topK: k,
          scoreThreshold
        });

  if (
    targetDatasets.length === 1 ||
    (targetDatasets.length >= 2 && useSingleSearch)
  ) {
    const filter = {
      must: [
        { key: "tenant", match: { value: tenant_id } },
        targetDatasets.length === 1
          ? { key: "dataset", match: { value: targetDatasets[0] } }
          : { key: "dataset", match: { any: targetDatasets } }
      ]
    };
    if (excludedRowIds && excludedRowIds.length > 0) {
      filter.must_not = excludedRowIds.map((rowId) => ({
        key: "row_id",
        match: { value: rowId }
      }));
    }
    logInfo("[streamChatRag] Qdrant search dispatch", {
      tenant_id,
      function_name: "runQdrantSearch",
      extra: {
        search_mode:
          targetDatasets.length === 1 ? "single_dataset" : "single_search_match_any",
        requested_target_datasets: requestedTargetDatasets,
        requested_target_dataset_count: requestedTargetDatasets.length,
        topK,
        hybrid: useHybrid,
        sparse_only: useSparseOnly,
        force_sparse_only: !!forceSparseOnly,
        use_single_search: !!useSingleSearch,
        filter_must: filter.must,
        filter_must_not_count: Array.isArray(filter.must_not) ? filter.must_not.length : 0
      }
    });
    const searchResult = await search(filter, topK);
    const raw = searchResult?.result;
    results = Array.isArray(raw) ? raw : raw?.points || [];
    logInfo("[streamChatRag] Qdrant search completed", {
      tenant_id,
      function_name: "runQdrantSearch",
      extra: {
        search_mode:
          targetDatasets.length === 1 ? "single_dataset" : "single_search_match_any",
        requested_target_datasets: requestedTargetDatasets,
        result_count: results.length,
        result_dataset_distribution: summarizeResultDatasets(results).slice(0, 20),
        ...summarizeDatasetFieldDiagnostics(results),
        result_sample: results.slice(0, 10).map((item) => getPayloadDatasetFields(item))
      }
    });
    if (targetDatasets.length >= 2 && useSingleSearch) {
      logInfo(
        "[streamChatRag] Single search (match.any) for multiple datasets",
        {
          tenant_id,
          function_name: "runQdrantSearch",
          extra: { datasets: targetDatasets.length, topK, hybrid: useHybrid }
        }
      );
    }
    return results;
  }

  const perDatasetK = Math.ceil(topK / targetDatasets.length);
  logInfo(
    "[streamChatRag] Per-dataset parallel search (total records >= 100k)",
    {
      tenant_id,
      function_name: "runQdrantSearch",
      extra: {
        datasets: targetDatasets,
        total_datasets: targetDatasets.length,
        topK,
        hybrid: useHybrid,
        per_dataset_topK: perDatasetK
      }
    }
  );
  const searchPromises = targetDatasets.map((datasetId) => {
    const filter = {
      must: [
        { key: "tenant", match: { value: tenant_id } },
        { key: "dataset", match: { value: datasetId } }
      ]
    };
    if (excludedRowIds && excludedRowIds.length > 0) {
      filter.must_not = excludedRowIds.map((rowId) => ({
        key: "row_id",
        match: { value: rowId }
      }));
    }
    return search(filter, perDatasetK);
  });
  const searchResults = await Promise.all(searchPromises);
  for (const res of searchResults) {
    const raw = res?.result;
    const list = Array.isArray(raw) ? raw : raw?.points || [];
    results.push(...list);
  }
  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  results = results.slice(0, topK);
  logInfo("[streamChatRag] Qdrant search completed", {
    tenant_id,
    function_name: "runQdrantSearch",
    extra: {
      search_mode: "per_dataset_parallel",
      requested_target_datasets: requestedTargetDatasets,
      requested_target_dataset_count: requestedTargetDatasets.length,
      per_dataset_topK: perDatasetK,
      result_count: results.length,
      result_dataset_distribution: summarizeResultDatasets(results).slice(0, 20),
      ...summarizeDatasetFieldDiagnostics(results),
      result_sample: results.slice(0, 10).map((item) => getPayloadDatasetFields(item))
    }
  });

  return results;
}

/**
 * Create Qdrant collection name
 * @param {string} tenantId - Tenant ID
 * @returns {string} - collection name (e.g., "cm_chunks__tenant_name")
 */
function getQdrantCollectionName(tenantId) {
  const collectionBase = environment.QDRANT_COLLECTION_BASE || "cm_chunks";
  return `${collectionBase}__${toSafeCollectionName(tenantId)}`;
}

// Create Qdrant client and generate message embedding (once per call, always new embedding)
async function initializeQdrantAndEmbedding({
                                              qdrant_url,
                                              tenant_id,
                                              message,
                                              embedModel,
                                              openai,
                                              withTimeout = null,
                                              retryOnRateLimit = null,
                                              embeddingTimeoutMs = 10 * 1000,
                                              embeddingRetryOptions = {
                                                maxRetries: 3,
                                                initialDelayMs: 1000,
                                                maxDelayMs: 5000
                                              }
                                            }) {
  const qdrantUrl = qdrant_url.trim();
  if (!qdrantUrl) {
    const error = new ApiError({
      errorCode: "INVALID_QDRANT_URL",
      message: "INVALID_QDRANT_URL",
      httpStatusCode: 400,
      returnToUser: true
    });
    logAndCaptureError(error, "[streamChatRag] Invalid Qdrant URL", {
      tenant_id,
      function_name: "initializeQdrantAndEmbedding",
      extra: { qdrant_url: qdrant_url }
    });
    throw error;
  }
  const qdrantTimeout = Number(environment.QDRANT_TIMEOUT_MS || "30000");
  const qdrant = makeQdrantClient(qdrantUrl, qdrantTimeout, tenant_id);
  const collection = getQdrantCollectionName(tenant_id);

  logInfo("[streamChatRag] Qdrant config", {
    tenant_id,
    function_name: "initializeQdrantAndEmbedding",
    extra: { qdrantUrl, collection, timeout: qdrantTimeout }
  });

  logInfo("[streamChatRag] Creating embedding", {
    tenant_id,
    function_name: "initializeQdrantAndEmbedding",
    extra: { embedModel, message_length: message.length }
  });

  const createEmbedding = () =>
    openai.embeddings.create({
      model: embedModel,
      input: message,
      encoding_format: "float"
    });

  const embedResponse = retryOnRateLimit
    ? await retryOnRateLimit(
      () =>
        withTimeout
          ? withTimeout(
            createEmbedding(),
            embeddingTimeoutMs,
            "OpenAI embedding API call timed out"
          )
          : createEmbedding(),
      embeddingRetryOptions
    )
    : withTimeout
      ? await withTimeout(
        createEmbedding(),
        embeddingTimeoutMs,
        "OpenAI embedding API call timed out"
      )
      : await createEmbedding();

  const queryVector = embedResponse.data[0].embedding;
  const totalTokens = embedResponse.usage?.total_tokens ?? 0;
  const currentUserEmbed = {
    at: Date.now(),
    text: message.trim(),
    vec: queryVector
  };

  logInfo("[streamChatRag] Embedding ready", {
    tenant_id,
    function_name: "initializeQdrantAndEmbedding",
    extra: { vector_dim: queryVector.length, total_tokens: totalTokens }
  });

  return {
    qdrant,
    collection,
    queryVector,
    currentUserEmbed,
    embeddingUsage:
      totalTokens > 0
        ? { model: embedModel, purpose: "embedding", input_tokens: totalTokens }
        : null
  };
}

/**
 * Delete all points of the dataset from Qdrant
 * @param {object} qdrant - Qdrant client (created by makeQdrantClient)
 * @param {string} collection - Collection name
 * @param {object} options - deletion options
 * @param {string} options.tenant - tenant ID
 * @param {string} options.dataset - dataset ID
 * @returns {Promise<{ collectionMissing: boolean }>}
 *   collectionMissing=true: collection does not exist, so no points to delete (404) → caller treats as success
 */
async function deleteDatasetFromQdrant(
  qdrant,
  collection,
  { tenant, dataset: datasetId }
) {
  const filter = {
    must: [
      { key: "tenant", match: { value: tenant } },
      { key: "dataset", match: { value: datasetId } }
    ]
  };

  const result = await qdrant.qdrantFetch(
    `/collections/${collection}/points/delete?wait=true`,
    {
      method: "POST",
      body: { filter },
      // If collection does not exist, vectors are already absent → treat as successful deletion
      allowStatuses: [404]
    }
  );

  return {
    collectionMissing: result?.allowedStatus === 404
  };
}

/**
 * Retrieve current row_id set of the dataset from Qdrant
 * @returns {Promise<{rowIds: Set<string>, collectionMissing: boolean}>}
 */
async function getDatasetRowIdsFromQdrant(
  qdrant,
  collection,
  { tenant, dataset: datasetId }
) {
  const rowIds = new Set();
  let offset = null;

  do {
    const result = await qdrant.qdrantFetch(
      `/collections/${collection}/points/scroll`,
      {
        method: "POST",
        body: {
          filter: {
            must: [
              { key: "tenant", match: { value: tenant } },
              { key: "dataset", match: { value: datasetId } }
            ]
          },
          limit: 10000,
          with_payload: ["row_id"],
          with_vector: false,
          offset
        },
        allowStatuses: [404]
      }
    );

    if (result?.allowedStatus === 404) {
      return { rowIds, collectionMissing: true };
    }

    const points = result?.result?.points;
    if (!Array.isArray(points)) {
      throw new Error("Invalid Qdrant scroll response: points array is missing");
    }
    for (const point of points) {
      const rowId = point?.payload?.row_id;
      if (rowId) rowIds.add(String(rowId));
    }
    offset = result?.result?.next_page_offset ?? null;
  } while (offset !== null);

  return { rowIds, collectionMissing: false };
}

module.exports = {
  toSafeCollectionName,
  textToBm25Sparse,
  makeQdrantClient,
  runQdrantSearch,
  initializeQdrantAndEmbedding,
  getQdrantCollectionName,
  deleteDatasetFromQdrant,
  getDatasetRowIdsFromQdrant
};