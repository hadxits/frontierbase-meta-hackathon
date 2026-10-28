/**
 * ARS: assemble keypad tree from row labels (deterministic, no LLM).
 * Depth max 3. Never emits the system catch-all bucket — overflow
 * deepens into intermediate folders, or absorbs into real sibling labels at max depth.
 *
 * Menu labels must come from the labeling LLM / source text (any language).
 * This module does not invent locale-specific words.
 */

const { ARS_OTHER_LABEL_KEY } = require("@/const/ArsMenuStatus");

const MAX_DEPTH = 3;
const MAX_SIBLINGS = 9;

/**
 * Normalize menu label for tree Map keys.
 * Do not hard-truncate: length is the labeling LLM's job; slicing here can merge distinct labels.
 */
function normLabel(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Keep one keypad topic — remove model middot joins like "error·failure·prior technology research".
 * Only split on · / • (not comma or slash — those appear in legitimate labels).
 * @param {string} raw
 * @returns {string}
 */
function singleTopicLabel(raw) {
  const n = normLabel(raw);
  if (!n) return "";
  if (!/[·•]/.test(n)) return n;
  const first = n.split(/\s*[·•]\s*/)[0];
  return normLabel(first) || n;
}

/**
 * True for empty or the legacy system bucket id only.
 * Locale catch-all words (any language) are rejected by the labeling prompt, not by word lists here.
 */
function isForbiddenCatchall(label) {
  const n = normLabel(label);
  return !n || n === ARS_OTHER_LABEL_KEY;
}

/**
 * @param {string} raw
 * @param {string} [fallback] - from source text / existing labels only (no fixed locale word)
 */
function sanitizeMenuLabel(raw, fallback = "") {
  const n = singleTopicLabel(raw);
  if (n && n !== ARS_OTHER_LABEL_KEY) return n;
  const fb = singleTopicLabel(fallback);
  if (fb && fb !== ARS_OTHER_LABEL_KEY) return fb;
  return "";
}

/**
 * Language-neutral hint from FAQ text (slice only — no invented words).
 */
function labelHintFromText(text, maxLen = 12) {
  const t = normLabel(text);
  if (!t) return "";
  return t.slice(0, maxLen);
}

/**
 * Source structured label — keep author middots; do not run singleTopicLabel.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeSourceCategoryLabel(raw) {
  const n = normLabel(raw);
  if (!n || n === ARS_OTHER_LABEL_KEY) return "";
  return n;
}

/**
 * Parse "Key: value" lines from CSV/Sheets → JSONL text (any header names).
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseStructuredFields(text) {
  /** @type {Record<string, string>} */
  const fields = {};
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const m = String(line).match(/^\s*([^:：\n]{1,64}?)\s*[:：]\s*(.*?)\s*$/);
    if (!m) continue;
    const key = normLabel(m[1]);
    const value = sanitizeSourceCategoryLabel(m[2]);
    if (!key || !value) continue;
    // First occurrence wins (stable); skip huge free-text blobs as section keys later via stats
    if (fields[key] == null) fields[key] = value;
  }
  return fields;
}

/**
 * @param {{ text?: string, rowMeta?: object|null }} row
 * @returns {Record<string, string>}
 */
function fieldsFromRow(row) {
  const fields = parseStructuredFields(row?.text);
  const meta = row?.rowMeta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    for (const [k, v] of Object.entries(meta)) {
      if (typeof v !== "string" && typeof v !== "number") continue;
      const key = normLabel(k);
      const value = sanitizeSourceCategoryLabel(String(v));
      if (!key || !value || fields[key] != null) continue;
      fields[key] = value;
    }
  }
  return fields;
}

/**
 * Infer which structured field is the section/category column (no fixed header names).
 * Prefers keys that cover most rows, with a moderate number of short repeated values.
 * @param {Array<{ text?: string, rowMeta?: object|null }>} rows
 * @returns {{ categoryKey: string|null, subcategoryKey: string|null }}
 */
function inferSectionFieldKeys(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const n = list.length || 1;
  /** @type {Map<string, { rowCount: number, valueCounts: Map<string, number>, valueLenSum: number }>} */
  const stats = new Map();

  for (const row of list) {
    const fields = fieldsFromRow(row);
    for (const [key, value] of Object.entries(fields)) {
      if (value.length > 48) continue;
      if (!stats.has(key)) {
        stats.set(key, { rowCount: 0, valueCounts: new Map(), valueLenSum: 0 });
      }
      const st = stats.get(key);
      st.rowCount += 1;
      st.valueCounts.set(value, (st.valueCounts.get(value) || 0) + 1);
      st.valueLenSum += value.length;
    }
  }

  /** @type {Array<{ key: string, score: number, uniq: number, coverage: number, avgLen: number }>} */
  const ranked = [];
  for (const [key, st] of stats.entries()) {
    const coverage = st.rowCount / n;
    const uniq = st.valueCounts.size;
    const avgLen = st.valueLenSum / Math.max(1, st.rowCount);
    if (coverage < 0.45) continue;
    if (uniq < 2 || uniq > 60) continue;
    if (avgLen > 36) continue;
    // Prefer section-like cardinality (~handful to tens of buckets), high coverage, short values.
    const uniqScore = 1 - Math.min(1, Math.abs(Math.log((uniq + 0.1) / 12)) / 3);
    const score = coverage * 0.55 + uniqScore * 0.35 + (1 - Math.min(1, avgLen / 36)) * 0.1;
    ranked.push({ key, score, uniq, coverage, avgLen });
  }
  ranked.sort((a, b) => b.score - a.score);

  const categoryKey = ranked[0]?.key || null;
  let subcategoryKey = null;
  for (const cand of ranked.slice(1)) {
    if (cand.key === categoryKey) continue;
    // Subcategory usually has more distinct values than the section field.
    if (categoryKey && cand.uniq <= (ranked[0]?.uniq || 0)) continue;
    subcategoryKey = cand.key;
    break;
  }
  if (!subcategoryKey && ranked[1]) subcategoryKey = ranked[1].key;

  return { categoryKey, subcategoryKey };
}

/**
 * @param {{ text?: string, rowMeta?: object|null }} row
 * @param {string|null|undefined} fieldKey
 * @returns {string}
 */
function fieldValueFromRow(row, fieldKey) {
  const key = normLabel(fieldKey);
  if (!key) return "";
  const fields = fieldsFromRow(row);
  return sanitizeSourceCategoryLabel(fields[key] || "");
}

function emptyNode(label) {
  return { label, children: new Map(), rows: [] };
}

function collectRows(n) {
  const out = [...(n.rows || [])];
  for (const c of n.children.values()) out.push(...collectRows(c));
  return out;
}

function nodeWeight(n) {
  return collectRows(n).length;
}

/**
 * Build a pressable folder label from member nodes (never the system catch-all id).
 * Use the dominant (heaviest) member label only — do not join with ·.
 * @param {Array<{label: string}>} members
 * @param {number} index 1-based
 */
function folderLabelFromMembers(members, index) {
  const sorted = [...(members || [])].sort(
    (a, b) => nodeWeight(b) - nodeWeight(a)
  );
  const a = sanitizeMenuLabel(sorted[0]?.label, "");
  if (a) return a;
  // Non-linguistic last resort (not a word in any locale)
  return `#${index}`;
}

/**
 * Ensure ≤ MAX_SIBLINGS children. Prefer deepening; at max depth absorb tiny
 * siblings into the largest real sibling (still a concrete label, not a catch-all bucket).
 * @param {Map<string, ReturnType<typeof emptyNode>>} map
 * @param {number} depth 1-based depth of these nodes
 * @returns {Map<string, ReturnType<typeof emptyNode>>}
 */
function fitSiblings(map, depth) {
  let entries = [...map.entries()].filter(([label]) => !isForbiddenCatchall(label));
  // Flatten any forbidden catch-all nodes into largest real sibling if present
  const forbidden = [...map.entries()].filter(([label]) => isForbiddenCatchall(label));
  if (forbidden.length && entries.length) {
    entries.sort((a, b) => nodeWeight(b[1]) - nodeWeight(a[1]));
    const target = entries[0][1];
    for (const [, n] of forbidden) {
      target.rows.push(...collectRows(n));
    }
  } else if (forbidden.length && !entries.length) {
    // Only catch-alls: promote content under a label derived from source text
    const bagRows = [];
    for (const [, n] of forbidden) bagRows.push(...collectRows(n));
    const derived =
      labelHintFromText(bagRows[0]?.text) ||
      labelHintFromText(bagRows[0]?.rowId) ||
      `#${depth}`;
    const merged = emptyNode(derived);
    for (const [, n] of forbidden) {
      merged.rows.push(...collectRows(n));
      for (const [cl, cn] of n.children.entries()) {
        if (isForbiddenCatchall(cl)) {
          merged.rows.push(...collectRows(cn));
        } else if (!merged.children.has(cl)) {
          merged.children.set(cl, cn);
        } else {
          merged.rows.push(...collectRows(cn));
        }
      }
    }
    merged.label = derived;
    entries = [[derived, merged]];
  }

  if (entries.length <= MAX_SIBLINGS) {
    return new Map(entries);
  }

  if (depth < MAX_DEPTH) {
    const n = entries.length;
    const numGroups = Math.min(MAX_SIBLINGS, Math.ceil(n / MAX_SIBLINGS));
    const perGroup = Math.ceil(n / numGroups);
    // Stable: keep larger topics first so folders reflect dominant themes
    entries.sort((a, b) => nodeWeight(b[1]) - nodeWeight(a[1]));
    const out = new Map();
    for (let g = 0; g < numGroups; g += 1) {
      const chunk = entries.slice(g * perGroup, (g + 1) * perGroup);
      if (!chunk.length) continue;
      let label = folderLabelFromMembers(
        chunk.map(([, node]) => node),
        g + 1
      );
      // Avoid colliding with an existing group key
      let unique = label;
      let suffix = 2;
      while (out.has(unique)) {
        unique = `${label.slice(0, 12)}${suffix}`;
        suffix += 1;
      }
      const folder = emptyNode(unique);
      for (const [childLabel, childNode] of chunk) {
        if (folder.children.has(childLabel)) {
          folder.rows.push(...collectRows(childNode));
        } else {
          folder.children.set(childLabel, childNode);
        }
      }
      // Recurse in case a folder still has >9 children
      folder.children = fitSiblings(folder.children, depth + 1);
      out.set(unique, folder);
    }
    return out;
  }

  // Max depth: absorb smallest into largest until ≤9 — no catch-all bucket.
  entries.sort((a, b) => nodeWeight(a[1]) - nodeWeight(b[1]));
  while (entries.length > MAX_SIBLINGS) {
    const [, small] = entries.shift();
    const large = entries[entries.length - 1][1];
    large.rows.push(...collectRows(small));
  }
  return new Map(entries);
}

/**
 * @param {Array<{rowId: string, text: string, depth1: string, depth2?: string, depth3?: string}>} labeledRows
 */
function assembleArsTree(labeledRows) {
  const root = emptyNode("ARS");

  for (const row of labeledRows || []) {
    const textHint = labelHintFromText(row.text);
    const d1 =
      sanitizeMenuLabel(row.depth1, textHint) ||
      textHint ||
      labelHintFromText(row.rowId) ||
      "#";
    let d2 = sanitizeMenuLabel(row.depth2, "");
    let d3 = sanitizeMenuLabel(row.depth3, "");

    if (!root.children.has(d1)) root.children.set(d1, emptyNode(d1));
    let node = root.children.get(d1);

    if (d2) {
      if (!node.children.has(d2)) node.children.set(d2, emptyNode(d2));
      node = node.children.get(d2);
    }
    if (d3) {
      if (!node.children.has(d3)) node.children.set(d3, emptyNode(d3));
      node = node.children.get(d3);
    }
    node.rows.push(row);
  }

  // Fit root children (depth 1) before build
  root.children = fitSiblings(root.children, 1);

  const leavesMeta = [];
  let needsReviewCount = 0;

  function build(map, depth) {
    const fitted = fitSiblings(map, depth);
    const nodes = [];
    let keyNum = 1;
    for (const [, n] of fitted) {
      if (keyNum > MAX_SIBLINGS) break;
      const key = String(keyNum);
      keyNum += 1;

      const childCount = n.children.size;
      if (childCount > 0 && depth < MAX_DEPTH) {
        const children = build(n.children, depth + 1);
        // rows parked on intermediate node → leaf using parent label (not catch-all)
        if ((n.rows || []).length > 0 && children.length < MAX_SIBLINGS) {
          const leaf = makeLeaf(String(children.length + 1), n.label, n.rows);
          children.push(leaf.node);
          leavesMeta.push(leaf.meta);
          if (leaf.meta.needs_review) needsReviewCount += 1;
        } else if ((n.rows || []).length > 0 && children.length >= MAX_SIBLINGS) {
          // No free key: fold parked rows into first child leaf content via first leaf sources
          const first = children[0];
          if (first) {
            const extraIds = (n.rows || []).map((r) => r.rowId).filter(Boolean);
            first.source_row_ids = [
              ...new Set([...(first.source_row_ids || []), ...extraIds])
            ];
            first.needs_review = true;
          }
        }
        nodes.push({
          key,
          label: n.label,
          children
        });
      } else {
        const rows = childCount > 0 ? collectRows(n) : n.rows || [];
        const leaf = makeLeaf(key, n.label, rows);
        nodes.push(leaf.node);
        leavesMeta.push(leaf.meta);
        if (leaf.meta.needs_review) needsReviewCount += 1;
      }
    }
    return nodes;
  }

  function makeLeaf(key, label, rows) {
    const source_row_ids = [
      ...new Set((rows || []).map((r) => r.rowId).filter(Boolean))
    ];
    const texts = (rows || []).map((r) => r.text).filter(Boolean);
    const needs_review = texts.length > 1;
    const safeLabel =
      sanitizeMenuLabel(label, labelHintFromText(texts[0])) ||
      labelHintFromText(texts[0]) ||
      labelHintFromText(source_row_ids[0]) ||
      key;
    return {
      node: {
        key,
        label: safeLabel,
        action: "play",
        source_row_ids,
        // Always filled by generateLeafAnswer (TTS-safe spoken prose), never raw CSV/table.
        answer_text: "",
        answer_candidates: texts.slice(0, 8),
        needs_review: needs_review || undefined
      },
      meta: {
        path_label: safeLabel,
        source_row_ids,
        needs_review,
        candidate_count: texts.length
      }
    };
  }

  const tree = {
    key: "0",
    label: "ARS",
    children: build(root.children, 1)
  };

  return {
    tree,
    leaves: leavesMeta,
    needs_review_count: needsReviewCount,
    max_depth: MAX_DEPTH
  };
}

function walkLeaves(node, visit, path = []) {
  if (!node) return;
  const children = Array.isArray(node.children) ? node.children : [];
  if (
    children.length === 0 &&
    (node.answer_text != null || node.source_row_ids)
  ) {
    visit(node, path.concat(node.label || node.key));
    return;
  }
  for (const c of children) {
    walkLeaves(c, visit, path.concat(node.label || node.key));
  }
}

function listLeaves(tree) {
  const out = [];
  walkLeaves(tree, (leaf) => out.push(leaf));
  return out;
}

module.exports = {
  assembleArsTree,
  listLeaves,
  sanitizeMenuLabel,
  labelHintFromText,
  fieldsFromRow,
  inferSectionFieldKeys,
  fieldValueFromRow
};
