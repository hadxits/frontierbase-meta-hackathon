/**
 * ============================================================================
 * SourceType.js - Data source type constants
 * ============================================================================
 *
 * Collection of constants defining data source types.
 * Use these constants in all files to avoid hardcoded strings.
 *
 * Usage example:
 *   const SourceType = require("@/const/SourceType");
 *   source_type: SourceType.EXCEL
 * ============================================================================
 */

/**
 * Data source types
 * @readonly
 * @enum {string}
 */
const SourceType = {
  /** Excel file (.xlsx, .xls) */
  EXCEL: "excel",

  /** CSV file (.csv) */
  CSV: "csv",

  /** Google Sheets */
  GOOGLE_SHEETS: "google_sheets",

  /** Manual input */
  MANUAL: "manual"
};

module.exports = SourceType;