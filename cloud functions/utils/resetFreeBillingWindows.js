/**
 * resetFreeBillingWindows.js — FREE 플랜 만료 빌링 윈도우 리셋
 * - plan == FREE && billing.windowEndAt <= now 인 테넌트
 * - 새 window 기록 + token_used_billing_month = 0
 * - tokenLowMailing 켜져 있으면 sent50/sent10 = false
 *
 * 중복 방지: 리셋 후 windowEndAt이 미래로 바뀌어 다음 쿼리에서 제외됨.
 * (하루 전 실행 X — 주기가 하루 일찍 끝나 보임. now-10분 슬롯 불필요.)
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const updateTokenUsage = require("@/utils/updateTokenUsage");
const { logInfo, logWarn, logAndCaptureError } = require("@/utils/logger");

const SCAN_PAGE_SIZE = 100;
const calculateBillingWindowForTenant =
  updateTokenUsage.calculateBillingWindowForTenant;

async function queryExpiredFreeTenants(nowMs) {
  return store
    .collection(Collection.TENANTS)
    .where("plan", "==", "FREE")
    .where("billing.windowEndAt", "<=", nowMs)
    .limit(SCAN_PAGE_SIZE)
    .get();
}

async function resetOneFreeTenant(tenantId, tenantData, now) {
  const billing = tenantData.billing || {};
  const result = calculateBillingWindowForTenant(billing, now);

  if (!result.shouldResetBillingMonth) {
    return { reset: false, reason: "not_expired" };
  }

  const startDay =
    billing.startDay != null ? billing.startDay : now.getDate();
  const updatePayload = {
    "billing.startDay": startDay,
    "billing.windowStartAt": result.windowStartAt.getTime(),
    "billing.windowEndAt": result.windowEndAt.getTime(),
    "usage.token_used_billing_month": 0,
    updated_at: now.getTime(),
  };

  if (tenantData?.alarm?.tokenLowMailing === true) {
    updatePayload["alarm.tokenLowMailingSent50ThisWindow"] = false;
    updatePayload["alarm.tokenLowMailingSent10ThisWindow"] = false;
  }

  await store.collection(Collection.TENANTS).doc(tenantId).update(updatePayload);
  return {
    reset: true,
    windowStartAt: result.windowStartAt.getTime(),
    windowEndAt: result.windowEndAt.getTime(),
  };
}

/**
 * @returns {Promise<object>}
 */
async function runResetFreeBillingWindows(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const summary = {
    scanned_at: now.toISOString(),
    scanned_count: 0,
    reset_count: 0,
    skipped: 0,
    errors: 0,
  };

  const snap = await queryExpiredFreeTenants(nowMs);

  for (const doc of snap.docs) {
    summary.scanned_count += 1;
    const tenantId = doc.id;
    const tenantData = doc.data() || {};

    try {
      const r = await resetOneFreeTenant(tenantId, tenantData, now);
      if (r.reset) {
        summary.reset_count += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (err) {
      summary.errors += 1;
      logWarn("[resetFreeBillingWindows] Reset failed", {
        tenant_id: tenantId,
        function_name: "runResetFreeBillingWindows",
        extra: { error: err?.message || String(err) },
      });
      logAndCaptureError(
        err instanceof Error ? err : new Error(String(err)),
        "[resetFreeBillingWindows] Reset failed",
        {
          tenant_id: tenantId || "unknown",
          function_name: "runResetFreeBillingWindows",
        }
      );
    }
  }

  logInfo("[resetFreeBillingWindows] Run completed", {
    tenant_id: "system",
    function_name: "runResetFreeBillingWindows",
    extra: summary,
  });

  return summary;
}

module.exports = {
  runResetFreeBillingWindows,
  SCAN_PAGE_SIZE,
};