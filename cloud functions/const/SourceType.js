/**
 * ============================================================================
 * SourceType.js - 데이터 소스 타입 상수
 * ============================================================================
 *
 * 데이터 소스 타입을 정의하는 상수 모음입니다.
 * 모든 파일에서 이 상수를 사용하여 하드코딩된 문자열 사용을 방지합니다.
 *
 * 사용 예:
 *   const SourceType = require("@/const/SourceType");
 *   source_type: SourceType.EXCEL
 * ============================================================================
 */

/**
 * 데이터 소스 타입
 * @readonly
 * @enum {string}
 */
const SourceType = {
  /** Excel 파일 (.xlsx, .xls) */
  EXCEL: "excel",

  /** CSV 파일 (.csv) */
  CSV: "csv",

  /** Google Sheets */
  GOOGLE_SHEETS: "google_sheets",

  /** 수동 입력 */
  MANUAL: "manual"
};

module.exports = SourceType;