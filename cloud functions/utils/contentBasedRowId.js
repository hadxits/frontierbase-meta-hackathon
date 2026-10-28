/**
 * Generate content-based row_id (Node.js - using crypto.createHash).
 * Same rules as client contentBasedRowId.js to ensure identical content yields same row_id.
 * - tenantId + datasetId + row content hash → 32-character hex.
 */

const crypto = require("crypto");

const MAX_VALUE_LENGTH = 200;
const MAX_INPUT_LENGTH = 2000;
const EXCLUDE_COLUMNS = ["_row_id_"];

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Generate string for hashing (same rules as client generateOptimizedContentHash).
 * @param {Object} rowData - key-value object (keys are string indexes "0","1",... or column names).
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
 * Create row_id using content-based hash (same as client generateContentBasedRowId).
 * @param {Object} rowData - row data object (keys: column index strings "0","1",...).
 * @param {Object} options
 * @param {string} options.tenantId
 * @param {string} options.datasetId
 * @param {string[]} options.includeColumns
 * @param {number} options.maxValueLength
 * @param {number} options.maxInputLength
 * @returns {string} 32-character hex string.
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