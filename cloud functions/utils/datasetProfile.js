"use strict";

const DATASET_PROFILE_VERSION = 1;
const DATASET_SHAPES = {
  DOCUMENT: "document",
  SHORTFORM: "shortform",
  MIXED: "mixed"
};

const ROW_KIND_GUESSES = {
  DOCUMENT_CLAUSE: "document_clause",
  SHORT_QA: "short_qa",
  RECORD: "record",
  LIST_ITEM: "list_item",
  UNKNOWN: "unknown"
};

function safeRatio(value, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Number((n / total).toFixed(4));
}

function safeAverage(values = []) {
  const nums = (Array.isArray(values) ? values : []).filter((value) =>
    Number.isFinite(Number(value))
  );
  if (nums.length === 0) return 0;
  return Number(
    (nums.reduce((sum, value) => sum + Number(value), 0) / nums.length).toFixed(2)
  );
}

function safeStdDev(values = []) {
  const nums = (Array.isArray(values) ? values : []).filter((value) =>
    Number.isFinite(Number(value))
  );
  if (nums.length <= 1) return 0;
  const avg = nums.reduce((sum, value) => sum + Number(value), 0) / nums.length;
  const variance =
    nums.reduce((sum, value) => sum + (Number(value) - avg) ** 2, 0) / nums.length;
  return Number(Math.sqrt(variance).toFixed(2));
}

function clampNonNegativeInt(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function countMatches(text, regex) {
  const matches = String(text || "").match(regex);
  return Array.isArray(matches) ? matches.length : 0;
}

function countCharsMatching(text, regex) {
  let count = 0;
  for (const ch of String(text || "")) {
    if (regex.test(ch)) count += 1;
  }
  return count;
}

function getNonEmptyLines(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function toShapeChar(ch) {
  if (/\p{Letter}/u.test(ch)) return "L";
  if (/\p{Number}/u.test(ch)) return "D";
  if (/\s/u.test(ch)) return "W";
  return "P";
}

function buildLineShapeSignature(line) {
  const prefix = String(line || "").trimStart().slice(0, 18);
  if (!prefix) return "";
  let out = "";
  let prev = "";
  for (const ch of prefix) {
    const next = toShapeChar(ch);
    if (next !== prev) out += next;
    prev = next;
  }
  return out;
}

function computeRepeatedPrefixRatio(lines) {
  const signatures = (Array.isArray(lines) ? lines : [])
    .map((line) => buildLineShapeSignature(line))
    .filter(Boolean);
  if (signatures.length === 0) return 0;
  const counts = new Map();
  for (const signature of signatures) {
    counts.set(signature, (counts.get(signature) || 0) + 1);
  }
  let maxCount = 0;
  for (const count of counts.values()) {
    if (count > maxCount) maxCount = count;
  }
  return safeRatio(maxCount, signatures.length);
}

function isStructurallyListLine(line) {
  const trimmed = String(line || "").trimStart();
  if (!trimmed) return false;
  if (/^\d+[.)-]\s+/u.test(trimmed)) return true;
  return /^[^\p{Letter}\p{Number}\s]\s+/u.test(trimmed);
}

function isStructurallyKeyValueLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;
  const delimiterMatch = trimmed.match(/[:=|\t]/u);
  if (!delimiterMatch || typeof delimiterMatch.index !== "number") return false;
  const idx = delimiterMatch.index;
  if (idx < 1 || idx > Math.max(2, Math.floor(trimmed.length * 0.45))) return false;
  const delimiterCount = countMatches(trimmed, /[:=|\t]/g);
  return delimiterCount >= 1 && delimiterCount <= 3;
}

function extractStructuredItemValue(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return "";
  const delimiterMatch = trimmed.match(/[:=|\t]/u);
  if (!delimiterMatch || typeof delimiterMatch.index !== "number") {
    return trimmed;
  }
  const idx = delimiterMatch.index;
  if (idx < 1 || idx > Math.max(2, Math.floor(trimmed.length * 0.45))) {
    return trimmed;
  }
  return trimmed.slice(idx + 1).trim();
}

function normalizeComparableItemValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isSentenceLikeLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;
  const whitespaceCount = countMatches(trimmed, /\s/g);
  const delimiterCount = countMatches(trimmed, /[:=|\t]/g);
  return (
    trimmed.length >= 32 &&
    whitespaceCount >= 3 &&
    delimiterCount <= 1
  );
}

function computeStructuralFeatures(text) {
  const raw = String(text || "");
  const normalized = raw.replace(/\s+/g, " ").trim();
  const textLength = normalized.length;
  const lines = getNonEmptyLines(raw);
  const lineLengths = lines.map((line) => line.length);
  const itemValues = lines
    .map((line) => extractStructuredItemValue(line))
    .filter((value) => value.length > 0);
  const distinctItemValues = [];
  const distinctItemKeys = new Set();
  for (const value of itemValues) {
    const normalizedValue = normalizeComparableItemValue(value);
    if (!normalizedValue || distinctItemKeys.has(normalizedValue)) continue;
    distinctItemKeys.add(normalizedValue);
    distinctItemValues.push(value);
  }
  const itemValueLengths = distinctItemValues.map((value) => value.length);
  const lineCount = lines.length;
  const avgLineLength = safeAverage(lineLengths);
  const avgItemLength = safeAverage(itemValueLengths);
  const lineLengthStdDev = safeStdDev(lineLengths);
  const firstLineLength = lineLengths[0] || 0;
  const restLineLengths = lineLengths.slice(1);
  const restAvgLineLength = safeAverage(restLineLengths);
  const digitRatio = safeRatio(countCharsMatching(normalized, /\p{Number}/u), textLength);
  const whitespaceRatio = safeRatio(countCharsMatching(normalized, /\s/u), textLength);
  const punctuationRatio = safeRatio(
    countCharsMatching(normalized, /[^\p{Letter}\p{Number}\s]/u),
    textLength
  );
  const delimiterDensity = safeRatio(countMatches(normalized, /[:=|\t]/g), textLength);
  const newlineDensity = safeRatio(countMatches(raw, /\n/g), Math.max(1, textLength));
  const questionMarkRatio = safeRatio(countMatches(normalized, /\?/g), Math.max(1, lineCount));
  const listLineRatio = safeRatio(
    lines.filter((line) => isStructurallyListLine(line)).length,
    lineCount
  );
  const keyValueLineRatio = safeRatio(
    lines.filter((line) => isStructurallyKeyValueLine(line)).length,
    lineCount
  );
  const sentenceLineRatio = safeRatio(
    lines.filter((line) => isSentenceLikeLine(line)).length,
    lineCount
  );
  const repeatedPrefixRatio = computeRepeatedPrefixRatio(lines);
  const headingBodyContrast =
    lineCount >= 2 && firstLineLength > 0 && restAvgLineLength > 0
      ? Number((restAvgLineLength / firstLineLength).toFixed(4))
      : 0;
  const hasSectionMarker =
    lineCount >= 2 &&
    (
      (firstLineLength > 0 &&
        firstLineLength <= 64 &&
        restAvgLineLength >= firstLineLength + 8 &&
        keyValueLineRatio < 0.5) ||
      (repeatedPrefixRatio >= 0.6 && sentenceLineRatio >= 0.25) ||
      (listLineRatio >= 0.5 && sentenceLineRatio >= 0.4)
    );
  const recordLike =
    keyValueLineRatio >= 0.5 ||
    (delimiterDensity >= 0.03 &&
      lineCount >= 2 &&
      avgLineLength <= 42 &&
      lineLengthStdDev <= 18);
  const listLike = listLineRatio >= 0.4;
  const faqLike =
    textLength <= 240 &&
    questionMarkRatio > 0 &&
    lineCount <= 3 &&
    keyValueLineRatio <= 0.5;
  const policyLike =
    hasSectionMarker ||
    (
      sentenceLineRatio >= 0.45 &&
      keyValueLineRatio < 0.35 &&
      (lineCount >= 2 || textLength >= 220)
    );
  const isLongText =
    textLength >= 320 ||
    (lineCount >= 4 && avgLineLength >= 40) ||
    sentenceLineRatio >= 0.75;

  return {
    text_length: textLength,
    line_count: lineCount,
    avg_line_length: avgLineLength,
    avg_item_length: avgItemLength,
    item_count: itemValues.length,
    distinct_item_count: distinctItemValues.length,
    line_length_stddev: lineLengthStdDev,
    digit_ratio: digitRatio,
    whitespace_ratio: whitespaceRatio,
    punctuation_ratio: punctuationRatio,
    delimiter_density: delimiterDensity,
    newline_density: newlineDensity,
    question_mark_ratio: questionMarkRatio,
    list_line_ratio: listLineRatio,
    key_value_line_ratio: keyValueLineRatio,
    sentence_line_ratio: sentenceLineRatio,
    repeated_prefix_ratio: repeatedPrefixRatio,
    heading_body_contrast: headingBodyContrast,
    has_section_marker: hasSectionMarker,
    record_like: recordLike,
    list_like: listLike,
    faq_like: faqLike,
    policy_like: policyLike,
    is_long_text: isLongText
  };
}

function buildRowProfileFromFeatures(features = {}) {
  let rowKindGuess = ROW_KIND_GUESSES.UNKNOWN;
  if (
    features.has_section_marker ||
    (
      features.policy_like &&
      features.record_like !== true &&
      features.sentence_line_ratio >= 0.35
    )
  ) {
    rowKindGuess = ROW_KIND_GUESSES.DOCUMENT_CLAUSE;
  } else if (features.faq_like && features.text_length <= 240) {
    rowKindGuess = ROW_KIND_GUESSES.SHORT_QA;
  } else if (features.record_like && features.text_length <= 420) {
    rowKindGuess = ROW_KIND_GUESSES.RECORD;
  } else if (features.list_like) {
    rowKindGuess = ROW_KIND_GUESSES.LIST_ITEM;
  }

  return {
    row_kind_guess: rowKindGuess,
    is_long_text: features.is_long_text,
    has_section_marker: features.has_section_marker,
    policy_like: features.policy_like,
    faq_like: features.faq_like,
    list_like: features.list_like,
    record_like: features.record_like,
    text_length: features.text_length
  };
}

function buildRowProfile(text) {
  return buildRowProfileFromFeatures(computeStructuralFeatures(text));
}

function deriveDatasetShape({
  avgItemLength,
  avgItemCount = 0,
  longRowRatio,
  sectionMarkerRatio,
  policyLikeRatio,
  faqLikeRatio,
  recordLikeRatio,
  compactItemRowRatio = 0,
  multilineRowRatio = 0,
  keyValueRatio = 0,
  sentenceLikeRatio = 0
}) {
  const compactItemShortformCandidate =
    compactItemRowRatio >= 0.6 || avgItemCount <= 4;

  if (
    avgItemLength >= 260 ||
    longRowRatio >= 0.3 ||
    sectionMarkerRatio >= 0.22 ||
    sentenceLikeRatio >= 0.48 ||
    (policyLikeRatio >= 0.45 && multilineRowRatio >= 0.35)
  ) {
    return DATASET_SHAPES.DOCUMENT;
  }
  if (
    avgItemLength <= 20 &&
    longRowRatio <= 0.15 &&
    sectionMarkerRatio <= 0.12 &&
    sentenceLikeRatio <= 0.3 &&
    (
      compactItemShortformCandidate ||
      faqLikeRatio + recordLikeRatio >= 0.5 ||
      keyValueRatio >= 0.45
    )
  ) {
    return DATASET_SHAPES.SHORTFORM;
  }
  return DATASET_SHAPES.MIXED;
}

function deriveRoutingDefaults(shape, signals) {
  if (shape === DATASET_SHAPES.DOCUMENT) {
    return {
      prefer_coverage_retrieval: true,
      prefer_conservative_answering: true,
      prefer_short_answer_protection: false
    };
  }
  if (shape === DATASET_SHAPES.SHORTFORM) {
    return {
      prefer_coverage_retrieval: false,
      prefer_conservative_answering:
        Number(signals?.policy_like_ratio || 0) >= 0.2,
      prefer_short_answer_protection: true
    };
  }
  return {
    prefer_coverage_retrieval: Number(signals?.policy_like_ratio || 0) >= 0.25,
    prefer_conservative_answering: Number(signals?.policy_like_ratio || 0) >= 0.2,
    prefer_short_answer_protection: Number(signals?.faq_like_ratio || 0) >= 0.35
  };
}

function buildDatasetProfile(rows = []) {
  const profiledRows = [];
  const rowKindCounts = {
    [ROW_KIND_GUESSES.DOCUMENT_CLAUSE]: 0,
    [ROW_KIND_GUESSES.SHORT_QA]: 0,
    [ROW_KIND_GUESSES.RECORD]: 0,
    [ROW_KIND_GUESSES.LIST_ITEM]: 0,
    [ROW_KIND_GUESSES.UNKNOWN]: 0
  };
  let totalTextLength = 0;
  let totalItemLength = 0;
  let totalItemCount = 0;
  let totalDistinctItemCount = 0;
  let longTextCount = 0;
  let compactItemRowCount = 0;
  let sectionMarkerCount = 0;
  let policyLikeCount = 0;
  let faqLikeCount = 0;
  let listLikeCount = 0;
  let recordLikeCount = 0;
  let multilineCount = 0;
  let sentenceLikeRatioSum = 0;
  let keyValueLineRatioSum = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const features = computeStructuralFeatures(row?.text || "");
    const rowMeta = buildRowProfileFromFeatures(features);
    profiledRows.push({
      ...row,
      rowMeta
    });
    totalTextLength += clampNonNegativeInt(rowMeta.text_length);
    totalItemLength +=
      Number(features.avg_item_length || 0) *
      Number(features.distinct_item_count || 0);
    totalItemCount += clampNonNegativeInt(features.item_count);
    totalDistinctItemCount += clampNonNegativeInt(features.distinct_item_count);
    if (Number(features.item_count || 0) > 0 && Number(features.item_count || 0) <= 4) {
      compactItemRowCount += 1;
    }
    if (rowMeta.is_long_text) longTextCount += 1;
    if (rowMeta.has_section_marker) sectionMarkerCount += 1;
    if (rowMeta.policy_like) policyLikeCount += 1;
    if (rowMeta.faq_like) faqLikeCount += 1;
    if (rowMeta.list_like) listLikeCount += 1;
    if (rowMeta.record_like) recordLikeCount += 1;
    if (features.line_count >= 2) multilineCount += 1;
    sentenceLikeRatioSum += Number(features.sentence_line_ratio || 0);
    keyValueLineRatioSum += Number(features.key_value_line_ratio || 0);
    rowKindCounts[rowMeta.row_kind_guess] += 1;
  }

  const rowCount = profiledRows.length;
  const avgTextLength = rowCount > 0
    ? Number((totalTextLength / rowCount).toFixed(2))
    : 0;
  const avgItemLength = totalDistinctItemCount > 0
    ? Number((totalItemLength / totalDistinctItemCount).toFixed(2))
    : 0;
  const avgItemCount = rowCount > 0
    ? Number((totalItemCount / rowCount).toFixed(2))
    : 0;
  const signals = {
    row_count: rowCount,
    avg_text_length: avgTextLength,
    avg_item_length: avgItemLength,
    avg_item_count: avgItemCount,
    compact_item_row_ratio: safeRatio(compactItemRowCount, rowCount),
    long_row_ratio: safeRatio(longTextCount, rowCount),
    section_marker_ratio: safeRatio(sectionMarkerCount, rowCount),
    policy_like_ratio: safeRatio(policyLikeCount, rowCount),
    faq_like_ratio: safeRatio(faqLikeCount, rowCount),
    list_like_ratio: safeRatio(listLikeCount, rowCount),
    record_like_ratio: safeRatio(recordLikeCount, rowCount),
    multiline_row_ratio: safeRatio(multilineCount, rowCount),
    sentence_like_ratio: Number((sentenceLikeRatioSum / Math.max(rowCount, 1)).toFixed(4)),
    key_value_row_ratio: Number((keyValueLineRatioSum / Math.max(rowCount, 1)).toFixed(4))
  };
  const shape = deriveDatasetShape({
    avgItemLength,
    avgItemCount,
    longRowRatio: signals.long_row_ratio,
    sectionMarkerRatio: signals.section_marker_ratio,
    policyLikeRatio: signals.policy_like_ratio,
    faqLikeRatio: signals.faq_like_ratio,
    recordLikeRatio: signals.record_like_ratio,
    compactItemRowRatio: signals.compact_item_row_ratio,
    multilineRowRatio: signals.multiline_row_ratio,
    sentenceLikeRatio: signals.sentence_like_ratio,
    keyValueRatio: signals.key_value_row_ratio
  });

  return {
    rows: profiledRows,
    datasetProfile: {
      profile_version: DATASET_PROFILE_VERSION,
      shape,
      signals,
      row_kind_distribution: rowKindCounts,
      routing_defaults: deriveRoutingDefaults(shape, signals)
    }
  };
}

module.exports = {
  DATASET_PROFILE_VERSION,
  DATASET_SHAPES,
  ROW_KIND_GUESSES,
  buildDatasetProfile
};