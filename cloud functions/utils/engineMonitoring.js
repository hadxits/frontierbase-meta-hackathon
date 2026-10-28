/**
 * ============================================================================
 * engineMonitoring.js - Engine monitoring utility
 * ============================================================================
 *
 * Record monitoring metrics in Firestore's engine collection.
 * Document ID: "summary" (single record)
 *
 * Collected metrics:
 * - Parsing stats (success/failure counts, success rate)
 * - Performance stats (response time)
 * - Model stats (usage count per model)
 * - Information extraction quality (number of fields filled)
 * - Error stats (count by error type)
 * ============================================================================
 */

const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { FieldValue } = require("firebase-admin/firestore");

const ENGINE_DOC_ID = "summary";


/**
 * Retrieves a reference to the engine document from the specified collection.
 */
function getEngineRef() {
  return store.collection(Collection.ENGINE).doc(ENGINE_DOC_ID);
}

/**
 * Convert model name to monitoring key
 * @param {string} modelName - model name (e.g., "gpt-4.1-mini", "gemini-3-pro-preview")
 * @returns {string} monitoring key (e.g., "gpt_4_1_mini", "gemini_3_pro", "gemini_3_flash_preview")
 */
function normalizeModelName(modelName) {
  if (!modelName) return "unknown";

  // Convert model name to lowercase and replace hyphens with underscores
  const normalized = modelName.toLowerCase().replace(/-/g, "_");

  // Specific model name mappings
  if (normalized.includes("gpt_4_1_mini")) {
    return "gpt_4_1_mini";
  }
  if (normalized.includes("gpt_4o_mini")) {
    return "gpt_4o_mini";
  }
  if (normalized.includes("gemini_3_pro")) {
    return "gemini_3_pro";
  }
  if (normalized.includes("gemini_3_flash")) {
    return "gemini_3_flash_preview";
  }
  if (normalized.includes("claude_sonnet_4")) {
    return "claude_sonnet_4_20250514";
  }

  return normalized;
}

/**
 * Update monitoring on parsing success
 * @param {Object} extractionData - extracted data info
 * @param {Object} extractionData.state - state object
 * @param {Object} extractionData.customer_profile - customer_profile object
 * @returns {Promise<void>}
 */
async function recordParsingSuccess(extractionData = {}) {
  try {
    const engineRef = getEngineRef();
    const now = Date.now();

    // Get current values (for success rate calculation)
    const currentDoc = await engineRef.get();
    const currentData = currentDoc.data() || {};
    const parsing = currentData.parsing || {};
    const totalAttempts = (parsing.total_attempts || 0) + 1;
    const successCount = (parsing.success_count || 0) + 1;
    const successRate = totalAttempts > 0 ? successCount / totalAttempts : 0;

    // Calculate information extraction quality (customer_profile: string with line breaks or legacy array)
    const state = extractionData.state || {};
    const profile = extractionData.customer_profile || {};
    const profileFieldCount = (v) => {
      if (Array.isArray(v)) return v.length;
      if (typeof v === "string") return v.split("\n").map((s) => s.trim()).filter(Boolean).length;
      return 0;
    };
    const stateFieldsFilled = [
      state.topic,
      state.goal,
      state.current_context
    ].filter((f) => f && f.trim()).length;
    const profileFieldsFilled = [
      profileFieldCount(profile.preferences) > 0,
      profileFieldCount(profile.facts) > 0,
      profileFieldCount(profile.constraints) > 0
    ].filter(Boolean).length;

    const updateData = {
      "parsing.total_attempts": FieldValue.increment(1),
      "parsing.success_count": FieldValue.increment(1),
      "parsing.success_rate": successRate,
      "parsing.last_success_at": now,
      "metadata.last_updated_at": now
    };

    // Update information extraction quality stats (current values needed for averaging)
    const quality = currentData.extraction_quality || {};
    const qualityRequestCount = (quality.request_count || 0) + 1;

    // Average calculation: (old average * old count + new value) / (old count + 1)
    const avgStateFields =
      quality.avg_state_fields_filled || 0;
    const avgProfileFields =
      quality.avg_profile_fields_filled || 0;
    const avgResolved = quality.avg_resolved_count || 0;
    const avgUnresolved = quality.avg_unresolved_count || 0;
    const avgPreferences = quality.avg_preferences_count || 0;
    const avgFacts = quality.avg_facts_count || 0;
    const avgConstraints = quality.avg_constraints_count || 0;

    updateData["extraction_quality.request_count"] = qualityRequestCount;
    updateData["extraction_quality.avg_state_fields_filled"] =
      (avgStateFields * (qualityRequestCount - 1) + stateFieldsFilled) /
      qualityRequestCount;
    updateData["extraction_quality.avg_profile_fields_filled"] =
      (avgProfileFields * (qualityRequestCount - 1) + profileFieldsFilled) /
      qualityRequestCount;
    updateData["extraction_quality.avg_resolved_count"] =
      (avgResolved * (qualityRequestCount - 1) +
        (state.resolved?.length || 0)) /
      qualityRequestCount;
    updateData["extraction_quality.avg_unresolved_count"] =
      (avgUnresolved * (qualityRequestCount - 1) +
        (state.unresolved?.length || 0)) /
      qualityRequestCount;
    updateData["extraction_quality.avg_preferences_count"] =
      (avgPreferences * (qualityRequestCount - 1) +
        profileFieldCount(profile.preferences)) /
      qualityRequestCount;
    updateData["extraction_quality.avg_facts_count"] =
      (avgFacts * (qualityRequestCount - 1) + profileFieldCount(profile.facts)) /
      qualityRequestCount;
    updateData["extraction_quality.avg_constraints_count"] =
      (avgConstraints * (qualityRequestCount - 1) +
        profileFieldCount(profile.constraints)) /
      qualityRequestCount;

    await engineRef.update(updateData);
  } catch (error) {
    // Monitoring failures only log errors and do not affect main logic
    console.error("[engineMonitoring] Failed to record parsing success", {
      error: error?.message || String(error)
    });
  }
}

/**
 * Update monitoring on parsing failure
 * @param {Error} parseError - parsing error object
 * @param {string} responseText - response text (max 300 chars)
 * @returns {Promise<void>}
 */
async function recordParsingFailure(parseError, responseText = "") {
  try {
    const engineRef = getEngineRef();
    const now = Date.now();

    // Get current values (for success rate calculation)
    const currentDoc = await engineRef.get();
    const currentData = currentDoc.data() || {};
    const parsing = currentData.parsing || {};
    const totalAttempts = (parsing.total_attempts || 0) + 1;
    const successCount = parsing.success_count || 0;
    const successRate = totalAttempts > 0 ? successCount / totalAttempts : 0;

    const updateData = {
      "parsing.total_attempts": FieldValue.increment(1),
      "parsing.failure_count": FieldValue.increment(1),
      "parsing.success_rate": successRate,
      "parsing.last_failure_at": now,
      "parsing.last_failure_error": parseError?.message || String(parseError),
      "parsing.last_failure_response": (responseText || "").slice(0, 300),
      "errors.total_errors": FieldValue.increment(1),
      "errors.parse_errors": FieldValue.increment(1),
      "errors.last_error_at": now,
      "errors.last_error_message": parseError?.message || String(parseError),
      "errors.last_error_type": "parse_error",
      "metadata.last_updated_at": now
    };

    await engineRef.update(updateData);
  } catch (error) {
    // Monitoring failures only log errors and do not affect main logic
    console.error("[engineMonitoring] Failed to record parsing failure", {
      error: error?.message || String(error)
    });
  }
}

/**
 * Update performance stats
 * @param {number} durationMs - elapsed time in milliseconds
 * @returns {Promise<void>}
 */
async function recordPerformance(durationMs) {
  try {
    const engineRef = getEngineRef();
    const now = Date.now();

    // Get current values (for averaging)
    const currentDoc = await engineRef.get();
    const currentData = currentDoc.data() || {};
    const performance = currentData.performance || {};
    const totalRequests = (performance.total_requests || 0) + 1;
    const totalDuration = (performance.total_duration_ms || 0) + durationMs;
    const avgDuration = totalRequests > 0 ? totalDuration / totalRequests : 0;
    const minDuration = Math.min(
      performance.min_duration_ms || Infinity,
      durationMs
    );
    const maxDuration = Math.max(
      performance.max_duration_ms || 0,
      durationMs
    );

    const updateData = {
      "performance.total_requests": totalRequests,
      "performance.total_duration_ms": totalDuration,
      "performance.avg_duration_ms": avgDuration,
      "performance.min_duration_ms": minDuration === Infinity ? durationMs : minDuration,
      "performance.max_duration_ms": maxDuration,
      "performance.last_request_at": now,
      "performance.last_duration_ms": durationMs,
      "metadata.last_updated_at": now
    };

    await engineRef.update(updateData);
  } catch (error) {
    // Monitoring failures only log errors and do not affect main logic
    console.error("[engineMonitoring] Failed to record performance", {
      error: error?.message || String(error)
    });
  }
}

/**
 * Update model usage stats
 * @param {string} modelName - model name
 * @returns {Promise<void>}
 */
async function recordModelUsage(modelName) {
  try {
    const engineRef = getEngineRef();
    const now = Date.now();
    const modelKey = normalizeModelName(modelName);

    const updateData = {
      [`model_usage.${modelKey}.count`]: FieldValue.increment(1),
      [`model_usage.${modelKey}.last_used_at`]: now,
      "metadata.last_updated_at": now
    };

    // Create safely with set(merge) even if document doesn't exist + increment accumulates atomically
    await engineRef.set(updateData, { merge: true });
  } catch (error) {
    // Monitoring failures only log errors and do not affect main logic
    console.error("[engineMonitoring] Failed to record model usage", {
      error: error?.message || String(error),
      modelName
    });
  }
}

/**
 * Update API error statistics
 * @param {Error} error - Error object
 * @param {string} errorType - Error type (e.g., "api_error", "timeout_error")
 * @returns {Promise<void>}
 */
async function recordError(error, errorType = "api_error") {
  try {
    const engineRef = getEngineRef();
    const now = Date.now();

    const updateData = {
      "errors.total_errors": FieldValue.increment(1),
      [`errors.${errorType}`]: FieldValue.increment(1),
      "errors.last_error_at": now,
      "errors.last_error_message": error?.message || String(error),
      "errors.last_error_type": errorType,
      "metadata.last_updated_at": now
    };

    await engineRef.update(updateData);
  } catch (monitoringError) {
    // Monitoring failures only log errors and do not affect main logic
    console.error("[engineMonitoring] Failed to record error", {
      error: monitoringError?.message || String(monitoringError)
    });
  }
}

/**
 * Initialize Engine monitoring (run only once)
 * @returns {Promise<void>}
 */
async function initializeEngineMonitoring() {
  try {
    const engineRef = getEngineRef();
    const doc = await engineRef.get();

    if (!doc.exists) {
      // Initial initialization
      const now = Date.now();
      await engineRef.set({
        parsing: {
          total_attempts: 0,
          success_count: 0,
          failure_count: 0,
          success_rate: 0.0,
          last_success_at: null,
          last_failure_at: null,
          last_failure_error: null,
          last_failure_response: null
        },
        performance: {
          total_requests: 0,
          total_duration_ms: 0,
          avg_duration_ms: 0.0,
          min_duration_ms: 0,
          max_duration_ms: 0,
          last_request_at: null,
          last_duration_ms: null
        },
        model_usage: {
          gpt_4_1_mini: {
            count: 0,
            last_used_at: null
          },
          gpt_4o_mini: {
            count: 0,
            last_used_at: null
          },
          gemini_3_pro: {
            count: 0,
            last_used_at: null
          },
          gemini_3_flash_preview: {
            count: 0,
            last_used_at: null
          }
        },
        extraction_quality: {
          last_verified_at: null,
          verified_samples: 0,
          accurate_extractions: 0,
          accuracy_rate: 0.0,
          request_count: 0,
          avg_state_fields_filled: 0.0,
          avg_profile_fields_filled: 0.0,
          avg_resolved_count: 0.0,
          avg_unresolved_count: 0.0,
          avg_preferences_count: 0.0,
          avg_facts_count: 0.0,
          avg_constraints_count: 0.0
        },
        errors: {
          total_errors: 0,
          parse_errors: 0,
          api_errors: 0,
          timeout_errors: 0,
          last_error_at: null,
          last_error_message: null,
          last_error_type: null
        },
        metadata: {
          last_updated_at: now,
          version: "1.0.0",
          collection_period_start: now
        }
      });
    }
  } catch (error) {
    console.error("[engineMonitoring] Failed to initialize", {
      error: error?.message || String(error)
    });
  }
}

module.exports = {
  recordParsingSuccess,
  recordParsingFailure,
  recordPerformance,
  recordModelUsage,
  recordError,
  initializeEngineMonitoring
};