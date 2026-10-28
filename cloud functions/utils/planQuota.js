/**
 * Quota limits per Plan (synchronized with license policy).
 * Used to update tenants.quota on payment complete/cancel/renew.
 */
const PLAN_QUOTA = {
  FREE: {
    token_limit_month: 200_000,
    dataset_limit: 1,
    row_limit_per_dataset: 100,
  },
  STARTER: {
    token_limit_month: 10_000_000,
    dataset_limit: 3,
    row_limit_per_dataset: 1_000,
  },
  PRO: {
    token_limit_month: 100_000_000,
    dataset_limit: 10,
    row_limit_per_dataset: 10_000,
  },
  ENTERPRISE: {
    token_limit_month: 1_000_000_000,
    dataset_limit: 999,
    row_limit_per_dataset: 1_000_000,
  },
};

/**
 * @param {string} plan - TENANT_PLAN (FREE, STARTER, PRO, ENTERPRISE)
 * @returns {{ token_limit_month: number, dataset_limit: number, row_limit_per_dataset: number }}
 */
function getQuotaForPlan(plan) {
  const key = String(plan || "FREE").toUpperCase();
  return PLAN_QUOTA[key] || PLAN_QUOTA.FREE;
}

module.exports = { getQuotaForPlan, PLAN_QUOTA };