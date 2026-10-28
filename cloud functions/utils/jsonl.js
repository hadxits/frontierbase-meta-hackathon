/**
 * JSONL (JSON Lines) parsing utility used commonly in uploadDataset, syncGoogleSheetsDataset, etc.
 * Each line contains one JSON object, using row_id / text / version as the basic contract.
 * Optional meta field is used to pass a light row profile in the ingest path.
 */

/**
 * Parses JSONL text and returns an array of rows and an issue summary.
 * @param {string} jsonlText - Text in JSONL format
 * @returns {{ rows: Array<{rowId: string, text: string, version: number, rowMeta?: object | null}>, issues: { invalid_json_lines: number, missing_row_id_lines: number, missing_text_lines: number } }}
 */
function parseJsonlToRows(jsonlText) {
  const lines = (jsonlText || "").replace(/\r\n/g, "\n").split("\n");
  const rows = [];
  const issues = {
    invalid_json_lines: 0,
    missing_row_id_lines: 0,
    missing_text_lines: 0
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch (e) {
      issues.invalid_json_lines += 1;
      continue;
    }
    const rowId = String(obj.row_id ?? "").trim();
    const text = String(obj.text ?? "").trim();
    const parsedVersion = Number(obj.version);
    const version =
      parsedVersion > 0 && Number.isInteger(parsedVersion) ? parsedVersion : 1;
    const rowMeta =
      obj.meta && typeof obj.meta === "object" && !Array.isArray(obj.meta)
        ? obj.meta
        : null;
    if (!rowId) {
      issues.missing_row_id_lines += 1;
      continue;
    }
    if (!text) {
      issues.missing_text_lines += 1;
      continue;
    }
    rows.push({ rowId, text, version, rowMeta });
  }
  return { rows, issues };
}

/**
 * Indicates if there are issues in the issues field of parseJsonlToRows return value.
 * @param {{ invalid_json_lines?: number, missing_row_id_lines?: number, missing_text_lines?: number } | null | undefined} issues
 * @returns {boolean}
 */
function hasJsonlParseIssues(issues) {
  return (
    Number(issues?.invalid_json_lines || 0) > 0 ||
    Number(issues?.missing_row_id_lines || 0) > 0 ||
    Number(issues?.missing_text_lines || 0) > 0
  );
}

/**
 * Compares two row arrays by rowId only to check if they are the same (ignores content changes).
 * @param {Array<{rowId: string, text: string, version: number}>} a
 * @param {Array<{rowId: string, text: string, version: number}>} b
 * @returns {boolean}
 */
function rowsEqual(a, b) {
  if (a.length !== b.length) return false;
  // Compare by rowId only.
  const bRowIdSet = new Set(b.map((r) => r.rowId));
  for (const r of a) {
    if (!bRowIdSet.has(r.rowId)) return false;
  }
  return true;
}

module.exports = {
  parseJsonlToRows,
  hasJsonlParseIssues,
  rowsEqual
};