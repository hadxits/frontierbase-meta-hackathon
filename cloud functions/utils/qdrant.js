const ApiError = require("@/errors/apiError");
const { logInfo, logAndCaptureError } = require("@/utils/logger");
const environment = require("@/env");

// Qdrant collection naming helper (worker.js와 동일)
function toSafeCollectionName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

// Named vector 이름 (worker와 동일)
const VECTOR_EMBEDDING = "embedding";
const VECTOR_BM25 = "bm25";

/**
 * BM25용 sparse 벡터 생성 (worker와 동일 로직 — 쿼리/문서 동일 토큰화)
 * @param {string} text - 원문
 * @returns {{ indices: number[], values: number[] }}
 */
function textToBm25Sparse(text) {
  if (!text || typeof text !== "string") {
    return { indices: [], values: [] };
  }
  // 다국어/혼합 언어 대응 토큰화:
  // - Latin(영/유럽권): 악센트 폴딩 + [a-z0-9] 단어 토큰 (길이>=2)
  // - Hangul(한국어): 한글 토큰 (길이>=1)
  // - CJK(일/중): 공백이 없을 수 있어 문자 bigram + 짧은 시퀀스 토큰을 함께 사용
  // ⚠️ worker.js와 반드시 동일 로직 유지
  const MAX_TOKENS = 512; // 과도한 토큰 폭주 방지
  const MAX_CJK_NGRAMS = 384;
  const MAX_LATIN_TOKENS = 192;
  const MAX_HANGUL_TOKENS = 192;

  const nfkc = text.normalize("NFKC").toLowerCase();

  // Latin: NFKD로 악센트 분해 후 결합문자 제거 → é/ö/ñ 등 폴딩
  const latinFold = nfkc.normalize("NFKD").replace(/\p{M}+/gu, "");
  const latinTokensRaw = latinFold.match(/[a-z0-9]{2,}/g) || [];
  const latinTokens = latinTokensRaw.slice(0, MAX_LATIN_TOKENS);

  // Hangul: 한글(가-힣) + 숫자 조합 토큰
  const hangulTokensRaw = nfkc.match(/[가-힣0-9]+/g) || [];
  const hangulTokens = hangulTokensRaw
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, MAX_HANGUL_TOKENS);

  // CJK 시퀀스(히라가나/가타카나/한자/반각 가타카나)
  const cjkSeqs =
    nfkc.match(
      /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff65-\uff9f]+/g
    ) || [];
  const cjkTokens = [];
  let cjkNgrams = 0;
  for (const seq of cjkSeqs) {
    const s = String(seq || "").trim();
    if (!s) continue;

    // 짧은 구간은 그대로 토큰으로 추가 (예: ダッシュボード, 設定 등)
    if (s.length >= 2 && s.length <= 12) cjkTokens.push(s);
    if (s.length === 1) cjkTokens.push(s);

    // 문자 bigram (CJK 전용 폴백)
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
        // 컬렉션 미존재(404) 등 호출자가 허용한 상태코드는 에러/로그 없이 통과
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
      // worker가 named vectors(embedding/bm25)로 컬렉션을 생성하므로,
      // dense-only 검색에서도 NamedVector 형식으로 "embedding"을 명시해야 안정적으로 동작함.
      // (버전에 따라 top-level `using` 필드는 /points/search 에서 무시될 수 있어,
      //  array vector만 보내면 Qdrant가 default(빈 이름) vector를 찾다가 400을 반환할 수 있음)
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

  // Sparse(BM25) 전용 검색: lookup/정형 Q&A에서 lexical recall 강화용
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
   * 하이브리드 검색 (Query API: prefetch embedding + bm25, fusion RRF)
   * RRF 점수는 코사인과 스케일이 달라 score_threshold는 적용하지 않음 (서버 필터는 filter만 사용).
   * @param {string} collection - 컬렉션 이름
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

// ✅ FIX: 중복 제거 - Qdrant 검색 공통 함수
// scoreThreshold: Qdrant 서버 측에서 score < scoreThreshold인 결과를 필터링
// useSingleSearch: true면 여러 dataset을 match.any로 한 번에 검색 (총 레코드 10만 미만일 때)
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
 * Qdrant 컬렉션 이름 생성
 * @param {string} tenantId - 테넌트 ID
 * @returns {string} - 컬렉션 이름 (예: "cm_chunks__tenant_name")
 */
function getQdrantCollectionName(tenantId) {
  const collectionBase = environment.QDRANT_COLLECTION_BASE || "cm_chunks";
  return `${collectionBase}__${toSafeCollectionName(tenantId)}`;
}

// Qdrant 클라이언트 생성 및 메시지 임베딩 생성 (호출당 1회, 항상 새 임베딩 생성)
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
 * Dataset의 모든 포인트를 Qdrant에서 삭제
 * @param {object} qdrant - Qdrant 클라이언트 (makeQdrantClient로 생성)
 * @param {string} collection - 컬렉션 이름
 * @param {object} options - 삭제 옵션
 * @param {string} options.tenant - 테넌트 ID
 * @param {string} options.dataset - 데이터셋 ID
 * @returns {Promise<{ collectionMissing: boolean }>}
 *   collectionMissing=true: 컬렉션이 없어 삭제할 포인트가 없음(404) → 호출자는 성공으로 처리
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
      // 컬렉션이 없으면 이미 벡터가 없는 상태 → 삭제 성공과 동일하게 처리
      allowStatuses: [404]
    }
  );

  return {
    collectionMissing: result?.allowedStatus === 404
  };
}

/**
 * Dataset의 현재 row_id 집합을 Qdrant에서 조회
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