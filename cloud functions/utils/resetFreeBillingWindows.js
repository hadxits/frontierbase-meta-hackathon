/**
 * resetFreeBillingWindows.js — Reset billing windows for FREE plan expiration
 * - Tenants where plan == FREE && billing.windowEndAt <= now
 * - Record new window + set token_used_billing_month = 0
 * - If tokenLowMailing is enabled, set sent50/sent10 = false
 *
 * Prevent duplicates: after reset, windowEndAt moves to future, excluding from next query.
 * (Do not run a day early — cycle appears to end a day early. No need for now-10min slot.)
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