/**
 * ============================================================================
 * deleteDataset.js - Dataset 삭제 엔드포인트
 * ============================================================================
 *
 * dataset_id를 지정하면 해당 dataset의 모든 row를 Qdrant에서 삭제하고
 * Firestore의 dataset 문서를 업데이트합니다.
 *
 * 주요 특징:
 * 1. Qdrant에서 dataset 필터로 모든 row 삭제
 * 2. Firestore dataset 문서 상태 업데이트 (status: DatasetStatus.DELETED)
 * 3. Tenant 검증 및 권한 확인
 *
 * 처리 흐름:
 * 1. 파라미터 검증
 * 2. Tenant 검증 및 데이터 로드
 * 3. Dataset 존재 확인
 * 4. Qdrant에서 dataset의 모든 row 삭제 (컬렉션 404는 이미 없음으로 성공 처리)
 * 5. Firestore dataset 문서 상태 업데이트 (status: DatasetStatus.DELETED)
 *
 * 참고:
 * - Qdrant 컬렉션은 tenant별로 관리됨: {base}__{tenant}
 * - dataset은 payload의 "dataset" 필드로 구분됨
 * - 삭제는 filter를 사용하여 tenant + dataset으로 필터링
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

// 다국어 지원 함수
const { getLocalizedErrorMessage } = require("@/utils/localization");

// Tenant 관련 공통 함수
const { loadAndValidateTenant } = require("@/utils/tenant");

// 메시지 관련 공통 함수
const { getDatasetSuccessMessage } = require("@/utils/messages");

// Dataset 상태 상수
const DatasetStatus = require("@/const/DatasetStatus");

// Qdrant 유틸리티
const { makeQdrantClient, getQdrantCollectionName, deleteDatasetFromQdrant } = require("@/utils/qdrant");

// VPC: VM Qdrant(내부 IP) 접근은 콘솔/배포 시 Direct VPC egress로 설정 (private-ranges-only)

const deleteDataset = _onRequest({
  opts: {
    memory: "1GiB", // 메모리 할당량 (1GB)
    cpu: 2, // vCPU 개수 (2세대: 1 또는 2, 기본값은 memory에 따라 1 또는 2)
    maxInstances: 4,
    concurrency: 2,
    timeoutSeconds: 300 // 9분 (대용량 파일 처리)
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
      // 1. 파라미터 검증
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
      // 2. Tenant 검증 및 데이터 로드
      // ========================================================================
      const { tenantData, locale, qdrant_url } = await loadAndValidateTenant(tenant, {
        locale: "en", // tenant 조회 전 임시 locale
        functionName: "deleteDataset"
      });

      // ========================================================================
      // 3. Dataset 존재 확인
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

      // 이미 삭제된 dataset인지 확인
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
      // 4. Qdrant에서 dataset의 모든 row 삭제
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

      // Qdrant 클라이언트 생성
      const qdrantTimeout = Number(environment.QDRANT_TIMEOUT_MS || "30000");
      const qdrant = makeQdrantClient(qdrant_url, qdrantTimeout, tenant);

      // Qdrant에서 dataset의 모든 row 삭제 (filter 사용)
      // tenant와 dataset으로 필터링하여 해당 dataset의 모든 포인트 삭제
      // 컬렉션 미존재(404)는 "이미 없음"으로 보고 성공 처리 → Firestore DELETED 진행
      // 그 외 Qdrant 실패 시에만 FAILED로 두고 에러
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
        // Qdrant 삭제 실패 시 dataset 상태를 failed로 변경 (재시도/원인 파악 가능하도록)
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
      // 5. Firestore dataset 문서 상태 업데이트
      // (Qdrant 삭제 성공 또는 컬렉션 미존재(404) 시)
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
      // 6. Tenant 소속 dataset이 전부 deleted이면 tenant status를 "pending"으로 변경
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

      // 성공 메시지 다국어 처리
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