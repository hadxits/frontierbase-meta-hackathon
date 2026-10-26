/**
 * JSONL(JSON Lines) 파싱 유틸 — uploadDataset, syncGoogleSheetsDataset 등에서 공통 사용.
 * 한 줄당 하나의 JSON 객체, row_id / text / version을 기본 계약으로 사용합니다.
 * optional meta 필드는 ingest 경로의 light row profile 전달에 사용됩니다.
 */

/**
 * JSONL 텍스트를 파싱해 행 배열과 이슈 요약 반환.
 * @param {string} jsonlText - JSONL 형식 텍스트
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
 * parseJsonlToRows 반환값의 issues에 문제가 있는지 여부.
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
 * 두 행 배열이 동일한지 rowId만으로 비교 (내용 변경 여부는 무시)
 * @param {Array<{rowId: string, text: string, version: number}>} a
 * @param {Array<{rowId: string, text: string, version: number}>} b
 * @returns {boolean}
 */
function rowsEqual(a, b) {
  if (a.length !== b.length) return false;
  // rowId만 비교
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