/**
 * ============================================================================
 * getSourceDownloadUrl.js - Dataset 소스 또는 gs:// 경로에 대한 임시 다운로드 URL 발급
 * ============================================================================
 *
 * firebase.js에서 export한 storage 사용 (uploadDataset.js와 동일).
 * source_ref(gs://bucket/path) 파싱 후 storage.bucket(bucket).file(filePath)로
 * 파일 참조하고, 10분 만료 signed URL을 반환합니다.
 *
 * - tenant 존재 및 요청자의 활성 멤버십 검증
 * - dataset_id 제공 시: Firestore dataset의 jsonl_paths 마지막 gcs_path 우선,
 *   없으면 source_ref (excel/csv/google_sheets 공통)
 * - source_ref 직접 제공 시: 해당 gs:// 경로 사용 (analytics 등)
 * - 선택: clientGcsGeneration, clientGcsUpdatedAt — GCS 메타와 모두 일치하면
 *   downloadUrl 없이 unchanged: true (불필요한 signed URL 발급 생략)
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

/** Signed URL 유효 시간 (분) */
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

/** GCS object updated(RFC3339) → ISO 8601 UTC 문자열 */
function gcsUpdatedToIso(updatedRaw) {
  if (updatedRaw == null || updatedRaw === "") return "";
  const ms = Date.parse(String(updatedRaw));
  if (!Number.isFinite(ms)) return String(updatedRaw);
  return new Date(ms).toISOString();
}

/**
 * 클라이언트가 보낸 generation·updated가 현재 객체 메타와 동일한지 (둘 다 있을 때만 true 가능)
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
      source_ref: { type: PropertyType.STRING }, // gs://bucket/path 형식 (dataset_id 없을 때)
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