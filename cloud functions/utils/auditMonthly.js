/**
 * Monthly token usage audit: tenants/{tenantId}/audit_monthly/{yyyy-mm}.
 * Accumulate by model and purpose (saved asynchronously after reply, try-catch prevents main logic impact).
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { FieldValue } = require("firebase-admin/firestore");
const { logInfo, logWarn } = require("@/utils/logger");
const { toUtcMonthKey } = require("@/utils/utcDateKey");

/**
 * Key for Firestore field names (remove . and -).
 * @param {string} s
 * @returns {string}
 */
function sanitizeKey(s) {
  if (typeof s !== "string") return "unknown";
  return s.replace(/[.-]/g, "_");
}

/**
 * Monthly key (yyyy-mm).
 * @param {Date} [d=new Date()]
 * @returns {string}
 */
function monthKey(d = new Date()) {
  return toUtcMonthKey(d);
}

/**
 * Single usage record.
 * @typedef {{ model: string, purpose: string, input_tokens?: number, output_tokens?: number }} UsageRecord
 */

/**
 * Accumulate tokens by model and purpose at tenants/{tenantId}/audit_monthly/{yyyy-mm}.
 * @param {string} tenant_id
 * @param {UsageRecord[]} usages
 * @param {Date} [at=new Date()]
 * @returns {Promise<void>}
 */
async function recordAuditMonthly(tenant_id, usages, at = new Date()) {
  if (!tenant_id || !Array.isArray(usages) || usages.length === 0) {
    return;
  }
  const yyyyMm = monthKey(at);
  const ref = store
    .collection(Collection.TENANTS)
    .doc(tenant_id)
    .collection(Collection.AUDIT_MONTHLY)
    .doc(yyyyMm);

  // If multiple entries for the same model/purpose exist, sum and increment once (prevent overwriting with duplicate keys).
  const byModel = {};
  const byPurpose = {};
  for (const u of usages) {
    const modelKey = sanitizeKey(u.model || "unknown");
    const purpose = String(u.purpose || "other").replace(/[.-]/g, "_");
    const input = Math.max(0, Number(u.input_tokens) || 0);
    const output = Math.max(0, Number(u.output_tokens) || 0);
    if (modelKey) {
      if (!byModel[modelKey]) byModel[modelKey] = { input: 0, output: 0 };
      byModel[modelKey].input += input;
      byModel[modelKey].output += output;
    }
    if (purpose) {
      if (!byPurpose[purpose]) byPurpose[purpose] = { input: 0, output: 0 };
      byPurpose[purpose].input += input;
      byPurpose[purpose].output += output;
    }
  }

  const updates = {
    month_key: yyyyMm,
    updated_at: at.getTime()
  };
  for (const [k, v] of Object.entries(byModel)) {
    updates[`by_model.${k}.input_tokens`] = FieldValue.increment(v.input);
    updates[`by_model.${k}.output_tokens`] = FieldValue.increment(v.output);
  }
  for (const [k, v] of Object.entries(byPurpose)) {
    updates[`by_purpose.${k}.input_tokens`] = FieldValue.increment(v.input);
    updates[`by_purpose.${k}.output_tokens`] = FieldValue.increment(v.output);
  }

  await ref.set(updates, { merge: true });
  logInfo("[auditMonthly] Recorded", {
    tenant_id,
    function_name: "auditMonthly",
    extra: {
      month_key: yyyyMm,
      usage_count: usages.length,
      purposes: Object.keys(byPurpose),
      models: Object.keys(byModel)
    }
  });
}

/**
 * Execute with setImmediate after sending response (for non-CF environments).
 * In Cloud Functions, async completion is not guaranteed after res.end().
 * In HTTP response functions, await recordAuditMonthly() just before res.end() is recommended.
 * @param {string} tenant_id
 * @param {UsageRecord[]} usages
 */
function scheduleAuditMonthlyAfterResponse(tenant_id, usages) {
  if (!tenant_id || !Array.isArray(usages) || usages.length === 0) return;
  setImmediate(() => {
    try {
      recordAuditMonthly(tenant_id, usages || []).catch((err) => {
        logWarn("[auditMonthly] Failed (non-blocking)", {
          tenant_id,
          function_name: "auditMonthly",
          extra: { error: err?.message || String(err) }
        });
      });
    } catch (e) {
      logWarn("[auditMonthly] Schedule failed (non-blocking)", {
        tenant_id,
        function_name: "auditMonthly",
        extra: { error: e?.message || String(e) }
      });
    }
  });
}

module.exports = {
  monthKey,
  sanitizeKey,
  recordAuditMonthly,
  scheduleAuditMonthlyAfterResponse
};