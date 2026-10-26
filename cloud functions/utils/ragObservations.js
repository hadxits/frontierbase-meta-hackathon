const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { logInfo, logWarn } = require("@/utils/logger");

const { toUtcDateKey, toUtcMonthKey } = require("@/utils/utcDateKey");

function monthKey(d = new Date()) {
  return toUtcMonthKey(d);
}

function dayKey(d = new Date()) {
  return toUtcDateKey(d);
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanString(value, max = 400) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, Math.max(1, Number(max) || 1));
}

function uniqueStrings(values, max = 12) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const cleaned = cleanString(value, 120);
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function limitObjects(values, max = 12) {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value) => value && typeof value === "object")
    .slice(0, Math.max(0, Number(max) || 0));
}

function summarizeTable(text) {
  const value = String(text || "").trim();
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return {
      looks_like_markdown_table: false,
      table_header_preview: [],
      table_row_count: 0,
      table_column_count: 0,
      empty_cell_ratio: null
    };
  }
  const separatorIdx = lines.findIndex((line) =>
    /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(line)
  );
  if (separatorIdx <= 0) {
    return {
      looks_like_markdown_table: false,
      table_header_preview: [],
      table_row_count: 0,
      table_column_count: 0,
      empty_cell_ratio: null
    };
  }

  const splitRow = (row) =>
    row
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const headers = splitRow(lines[separatorIdx - 1]);
  const bodyRows = lines
    .slice(separatorIdx + 1)
    .map(splitRow)
    .filter((cells) => cells.length > 0);
  const cellCount = bodyRows.reduce((sum, row) => sum + row.length, 0);
  const emptyCount = bodyRows.reduce(
    (sum, row) =>
      sum +
      row.filter((cell) => {
        const trimmed = String(cell || "").trim();
        return trimmed.length === 0 || trimmed === "-" || trimmed === "—";
      }).length,
    0
  );

  return {
    looks_like_markdown_table: headers.length > 1 && bodyRows.length > 0,
    table_header_preview: uniqueStrings(headers, 8),
    table_row_count: bodyRows.length,
    table_column_count: headers.length,
    empty_cell_ratio: cellCount > 0 ? Number((emptyCount / cellCount).toFixed(4)) : 0
  };
}

function buildFailureSignals(observation) {
  const signals = [];
  const question = observation?.question || {};
  const retrieval = observation?.retrieval || {};
  const answer = observation?.answer || {};
  const quality = observation?.quality || {};
  const requestStatus = String(observation?.request_status || "unknown");
  const entityCount = Number(question.entity_count) || 0;
  const preselected = Number(retrieval.preselected_count) || 0;
  const selected = Number(retrieval.selected_count) || 0;
  const filtered = Number(retrieval.filtered_results_count) || 0;
  const allResults = Number(retrieval.all_results_count) || 0;
  const needsWideContext =
    question.coverage_required === true ||
    question.intent === "compare" ||
    question.presentation_intent === "table" ||
    question.needs_full_breakdown === true ||
    entityCount >= 2;

  if (requestStatus !== "ok") {
    signals.push("request_error");
  }
  if (allResults === 0) {
    signals.push("no_retrieval_results");
  } else if (filtered === 0) {
    signals.push("filtered_results_empty");
  }
  if (
    needsWideContext &&
    preselected >= 10 &&
    selected > 0 &&
    selected <= Math.max(2, Math.floor(preselected * 0.25))
  ) {
    signals.push("premature_compression");
  }
  if (needsWideContext && entityCount >= 2 && selected > 0 && selected < entityCount) {
    signals.push("weak_coverage");
  }
  if (cleanString(answer.resolve_reason, 120)?.includes("verification_failed")) {
    signals.push("verification_reject");
  }
  if (answer.used_table_fallback === true) {
    signals.push("table_fallback_used");
  }
  if (
    answer.source === "evidence_table" &&
    (quality.low_quality_markdown_table === true ||
      quality.meta_field_axis_risk === true)
  ) {
    signals.push("bad_axis_selection");
  }
  if (
    question.presentation_intent === "table" &&
    quality.looks_like_markdown_table !== true &&
    requestStatus === "ok"
  ) {
    signals.push("table_request_not_rendered");
  }
  if (
    requestStatus === "ok" &&
    signals.length === 0 &&
    filtered > 0 &&
    selected <= 3 &&
    entityCount <= 1
  ) {
    signals.push("single_hop_ok");
  }
  return uniqueStrings(signals, 12);
}

function deriveFailureClass(observation, signals) {
  if (!Array.isArray(signals) || signals.length === 0) return "unknown";
  if (signals.includes("request_error")) return "request_error";
  if (signals.includes("bad_axis_selection")) return "bad_axis_selection";
  if (signals.includes("premature_compression")) return "premature_compression";
  if (signals.includes("weak_coverage")) return "weak_coverage";
  if (signals.includes("verification_reject")) return "verification_reject";
  if (
    signals.includes("no_retrieval_results") ||
    signals.includes("filtered_results_empty")
  ) {
    return "weak_retrieval";
  }
  if (signals.includes("table_request_not_rendered")) return "presentation_miss";
  if (signals.includes("single_hop_ok")) return "single_hop_ok";
  return cleanString(signals[0], 80) || "unknown";
}

function shouldPersistRagObservation(observation) {
  const requestStatus = String(observation?.request_status || "unknown");
  const signals = buildFailureSignals(observation);
  const failureClass = deriveFailureClass(observation, signals);
  const severeSignals = new Set([
    "request_error",
    "no_retrieval_results",
    "filtered_results_empty",
    "premature_compression",
    "weak_coverage",
    "verification_reject",
    "bad_axis_selection",
    "table_request_not_rendered"
  ]);
  const matchedSignals = signals.filter((signal) => severeSignals.has(signal));

  if (requestStatus !== "ok") {
    return {
      persist: true,
      reason: matchedSignals[0] || `failure_class:${failureClass || "request_error"}`
    };
  }
  if (matchedSignals.length > 0) {
    return { persist: true, reason: matchedSignals[0] };
  }
  if (
    failureClass &&
    failureClass !== "single_hop_ok" &&
    failureClass !== "unknown" &&
    failureClass !== "presentation_miss"
  ) {
    return { persist: true, reason: `failure_class:${failureClass}` };
  }
  return { persist: false, reason: "sampling_skip" };
}

function buildObservationId(runId, at) {
  const ts = Number(at?.getTime?.() || Date.now());
  const safeRunId = String(runId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
  const suffix = safeRunId || Math.random().toString(36).slice(2, 10);
  return `${ts}_${suffix}`;
}

function normalizeObservation(tenant_id, raw, at = new Date()) {
  const question = raw?.question && typeof raw.question === "object" ? raw.question : {};
  const retrieval =
    raw?.retrieval && typeof raw.retrieval === "object" ? raw.retrieval : {};
  const context = raw?.context && typeof raw.context === "object" ? raw.context : {};
  const answer = raw?.answer && typeof raw.answer === "object" ? raw.answer : {};
  const quality =
    raw?.quality && typeof raw.quality === "object" ? raw.quality : {};
  const answerPreviewSource =
    answer.final_text_preview ||
    answer.final_text ||
    answer.preferred_evidence_answer_preview ||
    answer.preferred_evidence_answer ||
    "";
  const tableSummary = summarizeTable(answerPreviewSource);
  const mergedQuality = {
    ...quality,
    ...tableSummary,
    meta_field_axis_risk:
      typeof quality.meta_field_axis_risk === "boolean"
        ? quality.meta_field_axis_risk
        : answer.source === "evidence_table" &&
          (quality.low_quality_markdown_table === true ||
            tableSummary.empty_cell_ratio >= 0.45)
  };
  const base = {
    tenant_id,
    conversation_id: cleanString(raw?.conversation_id, 160),
    runner_run_id: cleanString(raw?.runner_run_id, 160),
    runner_scenario_id: cleanString(raw?.runner_scenario_id, 160),
    runner_step: cleanString(raw?.runner_step, 80),
    month_key: monthKey(at),
    day_key: dayKey(at),
    observed_at: at.getTime(),
    request_status: cleanString(raw?.request_status, 40) || "unknown",
    message_preview: cleanString(raw?.message_preview, 400),
    message_length: toFiniteNumber(raw?.message_length),
    locale: cleanString(raw?.locale, 40),
    dataset_ids: uniqueStrings(raw?.dataset_ids, 30),
    question: {
      question_type: cleanString(question.question_type, 40),
      intent: cleanString(question.intent, 40),
      presentation_intent: cleanString(question.presentation_intent, 40),
      needs_full_breakdown: question.needs_full_breakdown === true,
      coverage_required: question.coverage_required === true,
      entity_count: Array.isArray(question.entities)
        ? question.entities.length
        : toFiniteNumber(question.entity_count) || 0,
      entities: uniqueStrings(question.entities, 12),
      target_field_hints: uniqueStrings(question.target_field_hints, 12),
      value_field_hints: uniqueStrings(question.value_field_hints, 12),
      group_by_field_hints: uniqueStrings(question.group_by_field_hints, 12),
      comparison_axis_hints: uniqueStrings(question.comparison_axis_hints, 12),
      snapshot: question.snapshot && typeof question.snapshot === "object"
        ? question.snapshot
        : null
    },
    retrieval: {
      topk_for_search: toFiniteNumber(retrieval.topk_for_search),
      all_results_count: toFiniteNumber(retrieval.all_results_count) || 0,
      filtered_results_count:
        toFiniteNumber(retrieval.filtered_results_count) || 0,
      preselected_count: toFiniteNumber(retrieval.preselected_count) || 0,
      selected_count: toFiniteNumber(retrieval.selected_count) || 0,
      dataset_spread: retrieval.dataset_spread && typeof retrieval.dataset_spread === "object"
        ? retrieval.dataset_spread
        : null,
      score_summary: retrieval.score_summary && typeof retrieval.score_summary === "object"
        ? retrieval.score_summary
        : null,
      top_candidate_ids: limitObjects(retrieval.top_candidate_ids, 12),
      selected_candidate_ids: limitObjects(retrieval.selected_candidate_ids, 12),
      used_summary_fallback: retrieval.used_summary_fallback === true,
      used_expanded_fallback: retrieval.used_expanded_fallback === true
    },
    context: {
      rag_context_length: toFiniteNumber(context.rag_context_length) || 0,
      context_chunk_count: toFiniteNumber(context.context_chunk_count) || 0,
      avg_chunk_chars: toFiniteNumber(context.avg_chunk_chars),
      debug: context.debug && typeof context.debug === "object" ? context.debug : null
    },
    answer: {
      source: cleanString(answer.source, 80),
      resolve_reason: cleanString(answer.resolve_reason, 160),
      selection_reason: cleanString(answer.selection_reason, 160),
      verification_reason: cleanString(answer.verification_reason, 160),
      verification_confidence: cleanString(answer.verification_confidence, 80),
      extraction_reason: cleanString(answer.extraction_reason, 160),
      structured_execution_status:
        answer.structured_execution_status &&
        typeof answer.structured_execution_status === "object"
          ? answer.structured_execution_status
          : null,
      used_table_fallback: answer.used_table_fallback === true,
      used_summary_fallback: answer.used_summary_fallback === true,
      used_main_model: answer.used_main_model === true,
      bypassed_main_model: answer.bypassed_main_model === true,
      delivery_model: cleanString(answer.delivery_model, 120),
      final_text_length: toFiniteNumber(answer.final_text_length) || 0,
      preferred_evidence_answer_length:
        toFiniteNumber(answer.preferred_evidence_answer_length) || 0,
      final_text_preview: cleanString(
        answer.final_text_preview || answer.final_text,
        240
      ),
      preferred_evidence_answer_preview: cleanString(
        answer.preferred_evidence_answer_preview || answer.preferred_evidence_answer,
        240
      ),
      error_code: cleanString(answer.error_code, 120),
      error_message_preview: cleanString(answer.error_message, 200)
    },
    quality: mergedQuality
  };
  const failureSignals = buildFailureSignals(base);
  return {
    ...base,
    failure_signals: failureSignals,
    failure_class: deriveFailureClass(base, failureSignals)
  };
}

async function recordRagObservation(tenant_id, observation, at = new Date()) {
  if (!tenant_id || !observation || typeof observation !== "object") {
    return { stored: false, reason: "invalid_args" };
  }
  const normalized = normalizeObservation(tenant_id, observation, at);
  const sampling = shouldPersistRagObservation(normalized);
  if (!sampling.persist) {
    return { stored: false, reason: sampling.reason };
  }

  const docId = buildObservationId(normalized.runner_run_id, at);
  const ref = store.collection(Collection.RAG_OBSERVATIONS).doc(docId);

  try {
    await ref.set(
      {
        observation_id: docId,
        sampling_reason: sampling.reason,
        created_at: at.getTime(),
        updated_at: at.getTime(),
        ...normalized
      },
      { merge: true }
    );
    logInfo("[ragObservations] Recorded", {
      tenant_id,
      function_name: "ragObservations",
      extra: {
        observation_id: docId,
        failure_class: normalized.failure_class,
        sampling_reason: sampling.reason
      }
    });
    return { stored: true, reason: sampling.reason, observation_id: docId };
  } catch (err) {
    logWarn("[ragObservations] Failed (non-blocking)", {
      tenant_id,
      function_name: "ragObservations",
      extra: { error: err?.message || String(err) }
    });
    return { stored: false, reason: "write_failed" };
  }
}

module.exports = {
  dayKey,
  monthKey,
  normalizeObservation,
  shouldPersistRagObservation,
  recordRagObservation
};