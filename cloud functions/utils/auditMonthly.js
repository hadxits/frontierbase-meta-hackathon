/**
 * 월별 토큰 사용량 감사: tenants/{tenantId}/audit_monthly/{yyyy-mm}
 * 모델별·목적별 누적 (reply 이후 비동기 저장, try-catch로 메인 로직에 영향 없음)
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { FieldValue } = require("firebase-admin/firestore");
const { logInfo, logWarn } = require("@/utils/logger");
const { toUtcMonthKey } = require("@/utils/utcDateKey");

/**
 * Firestore 필드명용 키 ( . - 제거)
 * @param {string} s
 * @returns {string}
 */
function sanitizeKey(s) {
  if (typeof s !== "string") return "unknown";
  return s.replace(/[.-]/g, "_");
}

/**
 * 월 키 (yyyy-mm)
 * @param {Date} [d=new Date()]
 * @returns {string}
 */
function monthKey(d = new Date()) {
  return toUtcMonthKey(d);
}

/**
 * 단일 사용량 기록
 * @typedef {{ model: string, purpose: string, input_tokens?: number, output_tokens?: number }} UsageRecord
 */

/**
 * tenants/{tenantId}/audit_monthly/{yyyy-mm} 에 모델별·목적별 토큰 누적
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

  // 동일 model/purpose가 여러 건이면 합산 후 한 번만 increment (같은 키 중복 시 덮어쓰기 방지)
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
 * 응답 전송 후 setImmediate로 실행 (비 CF 환경용).
 * Cloud Functions에서는 res.end() 후 비동기 완료가 보장되지 않으므로,
 * HTTP 응답을 보내는 함수에서는 res.end() 직전에 await recordAuditMonthly() 사용 권장.
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