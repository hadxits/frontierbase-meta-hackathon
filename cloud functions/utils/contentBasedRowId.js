/**
 * 내용 기반 row_id 생성 (Node.js - crypto.createHash 사용)
 * 클라이언트 contentBasedRowId.js와 동일한 규칙으로, 같은 행 내용 → 같은 row_id 보장.
 * - tenantId + datasetId + 행 내용 해시 → 32자 hex
 */

const crypto = require("crypto");

const MAX_VALUE_LENGTH = 200;
const MAX_INPUT_LENGTH = 2000;
const EXCLUDE_COLUMNS = ["_row_id_"];

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * 해시 입력용 문자열 생성 (클라이언트 generateOptimizedContentHash와 동일 규칙)
 * @param {Object} rowData - 키-값 객체 (키는 문자열 인덱스 "0","1",... 또는 컬럼명)
 * @param {Object} options
 * @param {string[]} options.includeColumns
 * @param {number} options.maxValueLength
 * @param {number} options.maxInputLength
 * @param {string[]} options.excludeColumns
 * @returns {string} parts.join("|")
 */
function generateOptimizedContentHash(rowData, options = {}) {
  const {
    includeColumns = [],
    maxValueLength = MAX_VALUE_LENGTH,
    maxInputLength = MAX_INPUT_LENGTH,
    excludeColumns = EXCLUDE_COLUMNS
  } = options;

  let columnsToUse =
    includeColumns.length > 0
      ? includeColumns.filter(
          (col) =>
            col &&
            typeof col === "string" &&
            col.trim() !== "" &&
            !excludeColumns.includes(col)
        )
      : Object.keys(rowData).filter(
          (col) =>
            col &&
            typeof col === "string" &&
            col.trim() !== "" &&
            !excludeColumns.includes(col)
        );

  const isNumeric = columnsToUse.every((k) => /^\d+$/.test(k));
  columnsToUse = isNumeric
    ? [...columnsToUse].sort((a, b) => Number(a) - Number(b))
    : [...columnsToUse].sort();

  const parts = [];
  let totalLength = 0;

  for (const col of columnsToUse) {
    if (!col || typeof col !== "string" || col.trim() === "") continue;

    let value = String(rowData[col] ?? "").trim();
    if (!value) continue;

    if (value.length > maxValueLength) {
      value = sha256Hex(value).slice(0, 16);
    }

    const part = `${col}:${value}`;

    if (totalLength + part.length > maxInputLength) {
      const remaining = columnsToUse
        .slice(parts.length)
        .map((c) => `${c}:${String(rowData[c] ?? "").trim()}`)
        .join("|");
      const remainingHash = sha256Hex(remaining).slice(0, 16);
      parts.push(`_remaining:${remainingHash}`);
      break;
    }
    parts.push(part);
    totalLength += part.length;
  }

  return parts.join("|");
}

/**
 * 내용 기반 해시로 row_id 생성 (클라이언트 generateContentBasedRowId와 동일)
 * @param {Object} rowData - 행 데이터 객체 (키: 컬럼 인덱스 문자열 "0","1",...)
 * @param {Object} options
 * @param {string} options.tenantId
 * @param {string} options.datasetId
 * @param {string[]} options.includeColumns
 * @param {number} options.maxValueLength
 * @param {number} options.maxInputLength
 * @returns {string} 32자 hex
 */
function generateContentBasedRowId(rowData, options = {}) {
  const {
    tenantId = "",
    datasetId = "",
    includeColumns = [],
    maxValueLength = MAX_VALUE_LENGTH,
    maxInputLength = MAX_INPUT_LENGTH
  } = options;

  const contentHash = generateOptimizedContentHash(rowData, {
    includeColumns,
    maxValueLength,
    maxInputLength,
    excludeColumns: EXCLUDE_COLUMNS
  });

  const input = `${tenantId}|${datasetId}|content:${contentHash}`;
  const hex = sha256Hex(input);
  return hex.slice(0, 32);
}

module.exports = {
  generateContentBasedRowId,
  generateOptimizedContentHash,
  sha256Hex,
  MAX_VALUE_LENGTH,
  MAX_INPUT_LENGTH,
  EXCLUDE_COLUMNS
};