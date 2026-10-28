/**
 * ============================================================================
 * getSourceDownloadUrl.js - Issue temporary download URL for Dataset source or gs:// path
 * ============================================================================
 *
 * Use storage exported from firebase.js (same as uploadDataset.js).
 * Parse source_ref (gs://bucket/path) then reference file with storage.bucket(bucket).file(filePath)
 * Return signed URL with 10-minute expiration.
 *
 * - Verify tenant existence and requester's active membership
 * - If dataset_id provided: prioritize last gcs_path in Firestore dataset's jsonl_paths,
 *   otherwise use source_ref (common for excel/csv/google_sheets)
 * - If source_ref provided directly: use that gs:// path (for analytics etc.)
 * - Optional: if clientGcsGeneration and clientGcsUpdatedAt both match GCS metadata,
 *   return unchanged: true without downloadUrl (skip unnecessary signed URL issuance)
 * ============================================================================
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { logInfo } = require("@/utils/logger");
const { loadAndValidateTenant } = require("@/utils/tenant");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { store, storage } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { loadTenantMember } = require("@/utils/tenantMembership");

/** Signed URL validity time (minutes) */
const SIGNED_URL_EXPIRY_MINUTES = 10;

async function assertActiveTenantMember(tenantId, uid, locale) {
  const member = await loadTenantMember(tenantId, uid);

  if (!member.isActive) {
    throw new ApiError({
      errorCode: "SOURCE_DOWNLOAD_FORBIDDEN",
      message: getLocalizedErrorMessage(locale, "SOURCE_DOWNLOAD_FORBIDDEN"),
      httpStatusCode: 403,
      returnToUser: true
    });
  }
}

/** Convert GCS object updated (RFC3339) to ISO 8601 UTC string */
function gcsUpdatedToIso(updatedRaw) {
  if (updatedRaw == null || updatedRaw === "") return "";
  const ms = Date.parse(String(updatedRaw));
  if (!Number.isFinite(ms)) return String(updatedRaw);
  return new Date(ms).toISOString();
}

/**
 * Check if client-sent generation and updated match current object metadata (only true if both present)
 */
function clientMetaMatchesObject(clientGen, clientUpdated, objectGen, objectUpdatedIso) {
  if (clientGen == null || clientUpdated == null) return false;
  const gen = String(clientGen).trim();
  const upd = String(clientUpdated).trim();
  if (!gen || !upd) return false;
  const serverGen = String(objectGen ?? "").trim();
  if (serverGen !== gen) return false;
  const clientMs = Date.parse(upd);
  const serverMs = Date.parse(objectUpdatedIso);
  if (Number.isFinite(clientMs) && Number.isFinite(serverMs)) {
    return clientMs === serverMs;
  }
  return objectUpdatedIso === upd;
}

/**
 * @param {Object|null|undefined} datasetData
 * @returns {string}
 */
function resolveSourceRefFromDataset(datasetData) {
  const jsonlPaths = datasetData?.jsonl_paths;
  if (Array.isArray(jsonlPaths) && jsonlPaths.length > 0) {
    const gcsPath = jsonlPaths[jsonlPaths.length - 1]?.gcs_path;
    if (typeof gcsPath === "string" && gcsPath.trim().startsWith("gs://")) {
      return gcsPath.trim();
    }
  }
  const ref = datasetData?.source_ref;
  return typeof ref === "string" ? ref.trim() : "";
}

/**
 * @param {string} sourceRef
 * @returns {{ bucket: string, filePath: string }}
 */
function parseGsSourceRef(sourceRef) {
  const gsPathMatch = sourceRef.trim().match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!gsPathMatch) {
    throw new ApiError({
      errorCode: "INVALID_STORAGE_PATH",
      message: getLocalizedErrorMessage("en", "INVALID_STORAGE_PATH"),
      httpStatusCode: 400,
      returnToUser: true
    });
  }
  return { bucket: gsPathMatch[1], filePath: gsPathMatch[2] };
}

/**
 * @param {Object} params
 * @param {string} params.tenant
 * @param {string} params.source_ref
 * @param {string} [params.clientGcsGeneration]
 * @param {string} [params.clientGcsUpdatedAt]
 * @param {string} [params.locale]
 * @param {string} [params.resolved_from] - "jsonl_paths" | "dataset_source_ref" | "request_source_ref"
 */
async function issueSignedDownloadUrl({
  tenant,
  source_ref,
  clientGcsGeneration,
  clientGcsUpdatedAt,
  locale = "en",
  resolved_from = "request_source_ref"
}) {
  const { bucket, filePath } = parseGsSourceRef(source_ref);
  const file = storage.bucket(bucket).file(filePath);

  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (err) {
    const code = err?.code;
    if (code === 404) {
      throw new ApiError({
        errorCode: "FILE_NOT_FOUND",
        message: getLocalizedErrorMessage(locale, "FILE_NOT_FOUND"),
        httpStatusCode: 404,
        returnToUser: true
      });
    }
    throw err;
  }

  const generation = String(metadata.generation ?? "");
  const updated = gcsUpdatedToIso(metadata.updated);

  const unchanged = clientMetaMatchesObject(
    clientGcsGeneration,
    clientGcsUpdatedAt,
    generation,
    updated
  );

  if (unchanged) {
    logInfo("[getSourceDownloadUrl] Object unchanged, skipping signed URL", {
      tenant_id: tenant,
      function_name: "getSourceDownloadUrl",
      extra: { source_ref: source_ref.trim(), generation, resolved_from }
    });
    return {
      downloadUrl: null,
      unchanged: true,
      generation,
      updated,
      source_ref: source_ref.trim(),
      resolved_from
    };
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_MINUTES * 60 * 1000);
  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: expiresAt
  });

  logInfo("[getSourceDownloadUrl] Signed URL issued", {
    tenant_id: tenant,
    function_name: "getSourceDownloadUrl",
    extra: {
      source_ref: source_ref.trim(),
      expires_minutes: SIGNED_URL_EXPIRY_MINUTES,
      resolved_from
    }
  });

  return {
    downloadUrl: signedUrl,
    expiresAt: expiresAt.getTime(),
    expiresInMinutes: SIGNED_URL_EXPIRY_MINUTES,
    generation,
    updated,
    source_ref: source_ref.trim(),
    resolved_from
  };
}

module.exports = _onRequest({
  opts: {
    memory: "512MiB",
    timeoutSeconds: 60,
    maxInstances: 4,
    concurrency: 5
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      dataset_id: { type: PropertyType.STRING },
      source_ref: { type: PropertyType.STRING }, // Format gs://bucket/path (when dataset_id is absent)
      clientGcsGeneration: { type: PropertyType.STRING },
      clientGcsUpdatedAt: { type: PropertyType.STRING }
    },
    required: ["tenant"]
  },
  handler: async (req) => {
    const {
      tenant,
      dataset_id: datasetIdBody,
      source_ref: sourceRefBody,
      clientGcsGeneration,
      clientGcsUpdatedAt
    } = req.body;

    const datasetId =
      datasetIdBody != null && String(datasetIdBody).trim()
        ? String(datasetIdBody).trim()
        : "";
    const requestSourceRef =
      sourceRefBody != null && String(sourceRefBody).trim()
        ? String(sourceRefBody).trim()
        : "";

    if (!datasetId && !requestSourceRef) {
      throw new ApiError({
        errorCode: "INVALID_STORAGE_PATH",
        message: getLocalizedErrorMessage("en", "INVALID_STORAGE_PATH"),
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const { locale } = await loadAndValidateTenant(tenant, {
      locale: "en",
      functionName: "getSourceDownloadUrl",
      requireQdrantUrl: false
    });
    await assertActiveTenantMember(tenant, req.auth.uid, locale);

    if (requestSourceRef && !requestSourceRef.startsWith("gs://")) {
      throw new ApiError({
        errorCode: "INVALID_STORAGE_PATH",
        message: getLocalizedErrorMessage(locale, "INVALID_STORAGE_PATH"),
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    if (datasetId) {
      const datasetRef = store
        .collection(Collection.TENANTS)
        .doc(tenant)
        .collection(Collection.DATASETS)
        .doc(datasetId);
      const datasetSnap = await datasetRef.get();
      if (!datasetSnap.exists) {
        throw new ApiError({
          errorCode: "DATASET_NOT_FOUND",
          message: getLocalizedErrorMessage(locale, "DATASET_NOT_FOUND"),
          httpStatusCode: 404,
          returnToUser: true
        });
      }

      const datasetData = datasetSnap.data() || {};
      const jsonlPaths = datasetData?.jsonl_paths;
      const hasJsonlPath =
        Array.isArray(jsonlPaths) &&
        jsonlPaths.length > 0 &&
        typeof jsonlPaths[jsonlPaths.length - 1]?.gcs_path === "string" &&
        jsonlPaths[jsonlPaths.length - 1].gcs_path.trim().startsWith("gs://");

      const resolvedSourceRef = resolveSourceRefFromDataset(datasetData);
      if (!resolvedSourceRef) {
        throw new ApiError({
          errorCode: "INVALID_STORAGE_PATH",
          message: getLocalizedErrorMessage(locale, "INVALID_STORAGE_PATH"),
          httpStatusCode: 400,
          returnToUser: true
        });
      }

      return issueSignedDownloadUrl({
        tenant,
        source_ref: resolvedSourceRef,
        clientGcsGeneration,
        clientGcsUpdatedAt,
        locale,
        resolved_from: hasJsonlPath ? "jsonl_paths" : "dataset_source_ref"
      });
    }

    return issueSignedDownloadUrl({
      tenant,
      source_ref: requestSourceRef,
      clientGcsGeneration,
      clientGcsUpdatedAt,
      locale,
      resolved_from: "request_source_ref"
    });
  }
});