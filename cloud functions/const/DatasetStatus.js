/**
 * ============================================================================
 * DatasetStatus.js - Dataset status constants
 * ============================================================================
 *
 * Collection of constants defining dataset status values.
 * Use these constants in all files to avoid hardcoded strings.
 *
 * Usage example:
 *   const DatasetStatus = require("@/const/DatasetStatus");
 *   status: DatasetStatus.INDEXING
 * ============================================================================
 */

/**
 * Dataset status values
 * @readonly
 * @enum {string}
 */
const DatasetStatus = {
  PROCESSING: "processing",
  /** Indexing in progress (embedding creation and Qdrant storage ongoing) */
  INDEXING: "indexing",

  /** Ready (indexing complete, available) */
  READY: "ready",

  /** Failed (error occurred or processing failed) */
  FAILED: "failed",

  /** Paused (excluded from search/conversation targets) */
  PAUSED: "paused",

  /** Deleted (dataset removed) */
  DELETED: "deleted"

};

module.exports = DatasetStatus;