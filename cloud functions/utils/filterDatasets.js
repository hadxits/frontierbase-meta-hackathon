/**
 * ============================================================================
 * filterDatasets.js - Dataset filtering utility
 * ============================================================================
 *
 * When dataset_ids are 3 or more, compare each dataset's embed_value with the question embedding
 * Filter only related datasets. Keep at least 3.
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

const MIN_DATASETS = 3; // Minimum number of datasets to keep
const SIMILARITY_THRESHOLD = 0.5; // Consider similarity 0.5 or higher as related

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
    // Check dataset documents first in cache (pass tenant metadata)
    const { results: cachedDatasetDocs, missingIds } =
        getCachedDatasets(tenantId, targetDatasets, tenantData);

    // Load only datasets not in cache from Firestore
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

      // Merge results (maintain targetDatasets order)
      let missingIdx = 0;
      for (let i = 0; i < targetDatasets.length; i++) {
        if (datasetDocs[i] === null) {
          const doc = missingDocs[missingIdx++];
          datasetDocs[i] = doc;

          // Save to cache
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

    // Calculate similarity between each dataset's embed_value and question embedding
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
        // Treat non-existent datasets as similarity 0
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
        // If embed_value is missing, treat similarity as 0
        datasetScores.push({
          datasetId,
          similarity: 0,
          hasEmbedValue: false
        });
        continue;
      }

      // Calculate cosine similarity
      const similarity = cosineSimilarity(queryVector, embedValue);
      datasetScores.push({
        datasetId,
        similarity,
        hasEmbedValue: true,
        description: datasetData?.description || ""
      });
    }

    // Sort by similarity (descending)
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

    // Filter: prioritize similarity 0.5 or higher. If fewer than 3 above 0.5, include lower similarities by order to keep at least 3
    const relevantDatasets = datasetScores.filter(
        (s) => s.hasEmbedValue && s.similarity >= SIMILARITY_THRESHOLD
    );
    const relevantDatasetIds = new Set(
        relevantDatasets.map((s) => s.datasetId)
    );

    let filteredTargetDatasets;

    if (relevantDatasets.length >= MIN_DATASETS) {
      // If 3 or more have similarity 0.5 or higher, use only those
      filteredTargetDatasets = relevantDatasets.map((s) => s.datasetId);
    } else if (relevantDatasets.length > 0) {
      // If 1-2 have similarity 0.5 or higher, fill the rest by similarity order (including below 0.5) to keep at least 3
      const remainingCount = MIN_DATASETS - relevantDatasets.length;
      const remainingDatasets = datasetScores
          .filter((s) => !relevantDatasetIds.has(s.datasetId))
          .slice(0, remainingCount);
      filteredTargetDatasets = [
        ...relevantDatasets.map((s) => s.datasetId),
        ...remainingDatasets.map((s) => s.datasetId)
      ];
    } else {
      // If none have similarity 0.5 or higher, select top 3 by similarity (including below 0.5)
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
    // Use original targetDatasets if filtering fails
    return targetDatasets;
  }
}

module.exports = {
  filterDatasetsBySimilarity,
  MIN_DATASETS
};