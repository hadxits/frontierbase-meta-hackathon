/**
 * ============================================================================
 * filterDatasets.js - Dataset 필터링 유틸리티
 * ============================================================================
 *
 * dataset_ids가 3개 이상일 때, 각 dataset의 embed_value와 질문 임베딩을 비교하여
 * 관련 있는 dataset만 필터링합니다. 최소 3개는 유지합니다.
 * ============================================================================
 */

const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { cosineSimilarity } = require("@/utils/cache");
const {
  getCachedDatasets,
  setCachedDataset
} = require("@/utils/memoryCache");
const { logInfo, logWarn, logOperationalWarn } = require("@/utils/logger");

const MIN_DATASETS = 3; // 최소 유지할 dataset 개수
const SIMILARITY_THRESHOLD = 0.5; // 유사도 0.5 이상을 관련 있음으로 간주

/**
 * Filters a given list of datasets by their similarity to a query vector while ensuring a minimum number of datasets are retained.
 * If the number of target datasets is below the required minimum or the query vector is missing, no filtering is applied.
 *
 * @param {string} tenantId - The identifier for the tenant requesting the filtration.
 * @param {Array<string>} targetDatasets - An array of dataset IDs to be filtered.
 * @param {Array<number>} queryVector - The query vector used to compute similarity scores.
 * @param {Object|null} [tenantData=null] - Optional tenant-specific metadata for cache resolution.
 * @return {Promise<Array<string>>} A promise that resolves to an array of filtered dataset IDs, sorted by similarity scores, with at least the minimum required number of datasets maintained.
 */
async function filterDatasetsBySimilarity(tenantId, targetDatasets, queryVector, tenantData = null) {

  logInfo(
      "[filterDatasets] Filtering datasets by embed_value similarity",
      {
        tenant_id: tenantId,
        function_name: "filterDatasetsBySimilarity",
        extra: {
          original_count: targetDatasets.length,
          query_vector_length: queryVector.length
        }
      }
  );

  try {
    // Dataset 문서들 캐시에서 먼저 확인 (tenant 메타데이터 전달)
    const { results: cachedDatasetDocs, missingIds } =
        getCachedDatasets(tenantId, targetDatasets, tenantData);

    // 캐시에 없는 dataset만 Firestore에서 로드
    let datasetDocs = [...cachedDatasetDocs];
    if (missingIds.length > 0) {
      logInfo(
          "[filterDatasets] Loading missing datasets from Firestore",
          {
            tenant_id: tenantId,
            function_name: "filterDatasetsBySimilarity",
            extra: {
              cached_count: targetDatasets.length - missingIds.length,
              missing_count: missingIds.length,
              missing_ids: missingIds
            }
          }
      );

      const missingDocs = await Promise.all(
          missingIds.map((datasetId) =>
              store
                  .collection(Collection.TENANTS)
                  .doc(tenantId)
                  .collection(Collection.DATASETS)
                  .doc(datasetId)
                  .get()
          )
      );

      // 결과 병합 (targetDatasets 순서 유지)
      let missingIdx = 0;
      for (let i = 0; i < targetDatasets.length; i++) {
        if (datasetDocs[i] === null) {
          const doc = missingDocs[missingIdx++];
          datasetDocs[i] = doc;

          // 캐시에 저장
          if (doc.exists) {
            setCachedDataset(tenantId, targetDatasets[i], doc.data());
          }
        }
      }
    } else {
      logInfo("[filterDatasets] All datasets found in cache", {
        tenant_id: tenantId,
        function_name: "filterDatasetsBySimilarity",
        extra: {
          cached_count: targetDatasets.length
        }
      });
    }

    // 각 dataset의 embed_value와 질문 임베딩의 유사도 계산
    const datasetScores = [];
    for (let i = 0; i < datasetDocs.length; i++) {
      const datasetDoc = datasetDocs[i];
      const datasetId = targetDatasets[i];

      if (!datasetDoc.exists) {
        logWarn("[filterDatasets] Dataset not found", {
          tenant_id: tenantId,
          function_name: "filterDatasetsBySimilarity",
          extra: { datasetId }
        });
        // 존재하지 않는 dataset은 유사도 0으로 처리
        datasetScores.push({
          datasetId,
          similarity: 0,
          hasEmbedValue: false
        });
        continue;
      }

      const datasetData = datasetDoc.data();
      const embedValue = datasetData?.embed_value;

      if (
          !embedValue ||
          !Array.isArray(embedValue) ||
          embedValue.length === 0
      ) {
        logWarn("[filterDatasets] Dataset missing embed_value", {
          tenant_id: tenantId,
          function_name: "filterDatasetsBySimilarity",
          extra: {
            datasetId,
            hasEmbedValue: !!embedValue
          }
        });
        // embed_value가 없으면 유사도 0으로 처리
        datasetScores.push({
          datasetId,
          similarity: 0,
          hasEmbedValue: false
        });
        continue;
      }

      // 코사인 유사도 계산
      const similarity = cosineSimilarity(queryVector, embedValue);
      datasetScores.push({
        datasetId,
        similarity,
        hasEmbedValue: true,
        description: datasetData?.description || ""
      });
    }

    // 유사도 기준으로 정렬 (높은 순서대로)
    datasetScores.sort((a, b) => b.similarity - a.similarity);

    logInfo("[filterDatasets] Dataset similarity scores", {
      tenant_id: tenantId,
      function_name: "filterDatasetsBySimilarity",
      extra: {
        scores: datasetScores.map((s) => ({
          datasetId: s.datasetId,
          similarity: s.similarity.toFixed(4),
          hasEmbedValue: s.hasEmbedValue
        }))
      }
    });

    // 필터링: 유사도 0.5 이상만 우선 대상. 0.5 이상이 3개 미만이면 0.5 이하도 유사도 순으로 포함해 최소 3개 유지
    const relevantDatasets = datasetScores.filter(
        (s) => s.hasEmbedValue && s.similarity >= SIMILARITY_THRESHOLD
    );
    const relevantDatasetIds = new Set(
        relevantDatasets.map((s) => s.datasetId)
    );

    let filteredTargetDatasets;

    if (relevantDatasets.length >= MIN_DATASETS) {
      // 유사도 0.5 이상이 3개 이상이면 해당 것만 사용
      filteredTargetDatasets = relevantDatasets.map((s) => s.datasetId);
    } else if (relevantDatasets.length > 0) {
      // 유사도 0.5 이상이 1~2개면, 나머지는 유사도 순(0.5 이하 포함)으로 채워 최소 3개 유지
      const remainingCount = MIN_DATASETS - relevantDatasets.length;
      const remainingDatasets = datasetScores
          .filter((s) => !relevantDatasetIds.has(s.datasetId))
          .slice(0, remainingCount);
      filteredTargetDatasets = [
        ...relevantDatasets.map((s) => s.datasetId),
        ...remainingDatasets.map((s) => s.datasetId)
      ];
    } else {
      // 유사도 0.5 이상이 없으면 유사도 순 상위 3개 선택 (0.5 이하 포함)
      filteredTargetDatasets = datasetScores
          .slice(0, MIN_DATASETS)
          .map((s) => s.datasetId);
    }

    logInfo("[filterDatasets] Datasets filtered by similarity", {
      tenant_id: tenantId,
      function_name: "filterDatasetsBySimilarity",
      extra: {
        original_count: targetDatasets.length,
        filtered_count: filteredTargetDatasets.length,
        filtered_datasets: filteredTargetDatasets,
        min_datasets_maintained: MIN_DATASETS
      }
    });

    return filteredTargetDatasets;
  } catch (filterErr) {
    logOperationalWarn(
      "[filterDatasets] Dataset filtering failed",
      {
        tenant_id: tenantId,
        function_name: "filterDatasetsBySimilarity",
        extra: {
          error: filterErr?.message || String(filterErr)
        }
      }
    );
    // 필터링 실패 시 원본 targetDatasets 사용
    return targetDatasets;
  }
}

module.exports = {
  filterDatasetsBySimilarity,
  MIN_DATASETS
};