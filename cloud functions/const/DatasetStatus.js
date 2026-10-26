/**
 * ============================================================================
 * DatasetStatus.js - Dataset 상태 상수
 * ============================================================================
 *
 * Dataset의 상태값을 정의하는 상수 모음입니다.
 * 모든 파일에서 이 상수를 사용하여 하드코딩된 문자열 사용을 방지합니다.
 *
 * 사용 예:
 *   const DatasetStatus = require("@/const/DatasetStatus");
 *   status: DatasetStatus.INDEXING
 * ============================================================================
 */

/**
 * Dataset 상태값
 * @readonly
 * @enum {string}
 */
const DatasetStatus = {
  PROCESSING: "processing",
  /** 인덱싱 중 (임베딩 생성 및 Qdrant 저장 진행 중) */
  INDEXING: "indexing",

  /** 준비 완료 (인덱싱 완료, 사용 가능) */
  READY: "ready",

  /** 실패 (에러 발생 또는 처리 실패) */
  FAILED: "failed",

  /** 일시중지됨 (검색/대화 대상에서 제외) */
  PAUSED: "paused",

  /** 삭제됨 (데이터셋이 삭제됨) */
  DELETED: "deleted"

};

module.exports = DatasetStatus;