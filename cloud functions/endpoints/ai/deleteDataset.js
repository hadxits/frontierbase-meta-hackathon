/**
 * ============================================================================
 * deleteDataset.js - Dataset deletion endpoint
 * ============================================================================
 *
 * If dataset_id is specified, delete all rows of that dataset from Qdrant and
 * update the dataset document in Firestore.
 *
 * Key features:
 * 1. Delete all rows in Qdrant filtered by dataset
 * 2. Update Firestore dataset document status (status: DatasetStatus.DELETED)
 * 3. Verify tenant and check permissions
 *
 * Process flow:
 * 1. Validate parameters
 * 2. Verify tenant and load data
 * 3. Confirm dataset existence
 * 4. Delete all rows of the dataset in Qdrant (treat collection 404 as already deleted and succeed)
 * 5. Update Firestore dataset document status (status: DatasetStatus.DELETED)
 *
 * Notes:
 * - Qdrant collections are managed per tenant: {base}__{tenant}
 * - Datasets are distinguished by the "dataset" field in the payload
 * - Deletion uses a filter combining tenant and dataset
 * ============================================================================
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { logInfo, logWarn, logAndCaptureError, markErrorCaptured, shouldCaptureError } = require("@/utils/logger");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { FieldValue } = require("firebase-admin/firestore");
const environment = require("@/env");

// Multilingual support functions
const { getLocalizedErrorMessage } = require("@/utils/localization");

// Common functions related to tenants
const { loadAndValidateTenant } = require("@/utils/tenant");

// Common functions related to messages
const { getDatasetSuccessMessage } = require("@/utils/messages");

// Dataset status constants
const DatasetStatus = require("@/const/DatasetStatus");

// Qdrant utilities
const { makeQdrantClient, getQdrantCollectionName, deleteDatasetFromQdrant } = require("@/utils/qdrant");

// VPC: VM Qdrant (internal IP) access is set to Direct VPC egress during console/deployment (private-ranges-only)

const deleteDataset = _onRequest({
  opts: {
    memory: "1GiB", // Memory allocation (1GB)
    cpu: 2, // Number of vCPUs (2nd gen: 1 or 2, default depends on memory)
    maxInstances: 4,
    concurrency: 2,
    timeoutSeconds: 300 // 9 minutes (for large file processing)
  },
  requireCredential: true,
  stream: false,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      dataset_id: { type: PropertyType.STRING } // dataset ID
    },
    required: ["tenant", "dataset_id"]
  },
  handler: async (req, res) => {
    try {
      const { tenant, dataset_id } = req.body;

      logInfo("[deleteDataset] Request received", {
        tenant_id: tenant,
        function_name: "deleteDataset",
        extra: { dataset_id }
      });

      // ========================================================================
      // 1. Validate parameters
      // ========================================================================
      if (
        !dataset_id ||
        typeof dataset_id !== "string" ||
        dataset_id.trim().length === 0
      ) {
        throw new ApiError({
          errorCode: "INVALID_DATASET_ID",
          message: getLocalizedErrorMessage("en", "INVALID_DATASET_ID"),
          httpStatusCode: 400,
          returnToUser: true
        });
      }

      // ========================================================================
      // 2. Verify tenant and load data
      // ========================================================================
      const { tenantData, locale, qdrant_url } = await loadAndValidateTenant(tenant, {
        locale: "en", // Temporary locale before tenant lookup
        functionName: "deleteDataset"
      });

      // ========================================================================
      // 3. Confirm dataset existence
      // ========================================================================
      const datasetRef = store
        .collection(Collection.TENANTS)
        .doc(tenant)
        .collection(Collection.DATASETS)
        .doc(dataset_id);

      const datasetDoc = await datasetRef.get();

      if (!datasetDoc.exists) {
        throw new ApiError({
          errorCode: "DATASET_NOT_FOUND",
          message: getLocalizedErrorMessage(locale, "DATASET_NOT_FOUND"),
          httpStatusCode: 404,
          returnToUser: true
        });
      }

      const datasetData = datasetDoc.data();

      // Check if the dataset is already deleted
      if (datasetData?.status === DatasetStatus.DELETED) {
        logWarn("[deleteDataset] Dataset already deleted", {
          tenant_id: tenant,
          function_name: "deleteDataset",
          extra: { dataset_id }
        });
        return {
          success: true,
          dataset_id,
          message: getLocalizedErrorMessage(locale, "DATASET_ALREADY_DELETED"),
          deleted_rows_count: 0
        };
      }

      // ========================================================================
      // 4. Delete all rows of the dataset in Qdrant
      // ========================================================================
      const collection = getQdrantCollectionName(tenant);
      let qdrantHost = "(no url)";
      try {
        if (qdrant_url) qdrantHost = new URL(qdrant_url).host;
      } catch (_) {
        qdrantHost = String(qdrant_url).slice(0, 60) || "(invalid)";
      }
      logInfo("[deleteDataset] Deleting rows from Qdrant", {
        tenant_id: tenant,
        function_name: "deleteDataset",
        extra: {
          dataset_id,
          collection,
          qdrant_host: qdrantHost,
          qdrant_url: qdrant_url || "(empty)"
        }
      });

      // Create Qdrant client
      const qdrantTimeout = Number(environment.QDRANT_TIMEOUT_MS || "30000");
      const qdrant = makeQdrantClient(qdrant_url, qdrantTimeout, tenant);

      // Delete all rows of the dataset in Qdrant (using filter)
      // Filter by tenant and dataset to delete all points of that dataset
      // If collection does not exist (404), treat as "already deleted" and succeed → proceed with Firestore DELETED update
      // Only mark as FAILED and error on other Qdrant failures
      try {
        const qdrantDeleteResult = await deleteDatasetFromQdrant(qdrant, collection, {
          tenant,
          dataset: dataset_id
        });

        if (qdrantDeleteResult?.collectionMissing) {
          logInfo("[deleteDataset] Qdrant collection missing; treating as already deleted", {
            tenant_id: tenant,
            function_name: "deleteDataset",
            extra: { dataset_id, collection }
          });
        } else {
          logInfo("[deleteDataset] Rows deleted from Qdrant", {
            tenant_id: tenant,
            function_name: "deleteDataset",
            extra: { dataset_id, collection }
          });
        }
      } catch (qdrantError) {
        const cause = qdrantError?.cause;
        logAndCaptureError(
          qdrantError instanceof Error ? qdrantError : new Error(String(qdrantError)),
          "[deleteDataset] Failed to delete rows from Qdrant",
          {
            tenant_id: tenant,
            function_name: "deleteDataset",
            extra: {
              dataset_id,
              collection,
              qdrant_url: qdrant_url || "(empty)",
              qdrant_timeout_ms: qdrantTimeout,
              error_message: qdrantError?.message ?? "(none)",
              qdrant_status: qdrantError?.status ?? "(none)",
              qdrant_response_body:
                qdrantError?.responseBody != null
                  ? String(qdrantError.responseBody).slice(0, 500)
                  : "(none)",
              error_cause_code: cause?.code ?? "(none)",
              error_cause_message: cause?.message ?? "(none)",
              error_cause: cause != null ? String(cause) : "(none)"
            }
          }
        );
        // If Qdrant deletion fails, set dataset status to failed (to allow retry and cause investigation)
        await datasetRef.set(
          {
            status: DatasetStatus.FAILED,
            updated_at: Date.now(),
            error: qdrantError?.message || "Qdrant delete failed"
          },
          { merge: true }
        );
        throw markErrorCaptured(
          new ApiError({
            errorCode: "QDRANT_DELETE_FAILED",
            message: getLocalizedErrorMessage(locale, "QDRANT_DELETE_FAILED"),
            httpStatusCode: 500
          })
        );
      }

      // ========================================================================
      // 5. Update Firestore dataset document status
      // (When Qdrant deletion succeeds or collection does not exist (404))
      // ========================================================================
      await datasetRef.set(
        {
          status: DatasetStatus.DELETED,
          deleted_at: Date.now(),
          updated_at: Date.now()
        },
        { merge: true }
      );

      logInfo("[deleteDataset] Dataset document updated", {
        tenant_id: tenant,
        function_name: "deleteDataset",
        extra: { dataset_id, status: DatasetStatus.DELETED }
      });

      // ========================================================================
      // 6. If all datasets of the tenant are deleted, change tenant status to "pending"
      // ========================================================================
      const datasetsSnap = await store
        .collection(Collection.TENANTS)
        .doc(tenant)
        .collection(Collection.DATASETS)
        .get();

      const allDeleted =
        datasetsSnap.empty ||
        datasetsSnap.docs.every(
          (doc) => doc.data()?.status === DatasetStatus.DELETED
        );

      if (allDeleted) {
        const tenantRef = store.collection(Collection.TENANTS).doc(tenant);
        await tenantRef.set(
          { status: "pending", updated_at: Date.now() },
          { merge: true }
        );
        logInfo("[deleteDataset] Tenant status set to pending (all datasets deleted)", {
          tenant_id: tenant,
          function_name: "deleteDataset",
          extra: { dataset_count: datasetsSnap.size }
        });
      }

      // Multilingual processing of success messages
      const successMessage = getDatasetSuccessMessage(locale, "delete");

      return {
        success: true,
        dataset_id,
        message: successMessage,
        deleted_at: new Date().toISOString()
      };
    } catch (e) {
      if (shouldCaptureError(e)) {
        logAndCaptureError(
          e instanceof Error ? e : new Error(String(e)),
          "[deleteDataset] Error",
          {
            tenant_id: req?.body?.tenant || "unknown",
            function_name: "deleteDataset",
            extra: {
              dataset_id: req?.body?.dataset_id,
              errorCode: e instanceof ApiError ? e.errorCode : undefined
            }
          }
        );
      }
      throw e;
    }
  }
});

module.exports = deleteDataset;