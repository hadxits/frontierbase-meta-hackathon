/**
 * ============================================================================
 * updateTokenUsage.js - Utility to update token usage.
 * ============================================================================
 *
 * Updates token usage in Firestore (based on billing month).
 *
 * Update targets:
 * - usage fields in tenants/{tenant_id} document (includes token_used_billing_month, token_used_month, token_used_today).
 * - Create/update tenants/{tenant_id}/usage_daily/{dateKey} document (store created_at on first creation).
 * Create or update the tenants/{tenant_id}/usage_monthly/{monthKey} document (store created_at on first creation)
 * Create or update the tenants/{tenant_id}/usage_billing/{billingKey} document (store created_at on first creation)
 * Reset token_used_billing_month and recalculate window when billing window expires
 *
 * @param {string} tenantId - Tenant ID
 * @param {number} tokenCount - Number of tokens used
 * @param {Object} options - Optional parameters
 * @param {Date} options.now - Current time (for testing, default: new Date())
 * @param {boolean} [options.incrementMessageTotal] - usage_daily/monthly message.total +1
 * @param {boolean} [options.skipTokenUsage] - Skip deducting tokens/addons/usage tokens (message only)
 */
const { store } = require("@/firebase");
const { FieldValue, FieldPath } = require("firebase-admin/firestore");
const Collection = require("@/const/firestore/Collection");
const {
  calculateBillingWindow,
  isBillingWindowExpired,
  generateBillingKey,
  formatDateString
} = require("@/utils/calculateBillingWindow");
const { toUtcDateKey, toUtcMonthKey } = require("@/utils/utcDateKey");
const { logInfo, logWarn, logAndCaptureError } = require("@/utils/logger");
const { captureMessage } = require("@/utils/sentry");
const {
  processAddonStatus,
  consumeAddonTokens
} = require("@/utils/addonToken");

/**
 * Calculate tenant's billing window (reusable function)
 * @param {Object} billing - billing field of the tenant document
 * @param {Date} now - current time
 * @returns {{windowStartAt: Date, windowEndAt: Date, shouldResetBillingMonth: boolean}}
 */
function calculateBillingWindowForTenant(billing, now) {
  // If startDay is null, set based on today's day of the month
  const startDay = billing?.startDay != null ? billing.startDay : now.getDate();

  // Convert number type timestamp to Date (always stored as number)
  let existingWindowStartAt = null;
  let existingWindowEndAt = null;

  if (billing?.windowStartAt) {
    existingWindowStartAt = new Date(billing.windowStartAt);
  }

  if (billing?.windowEndAt) {
    existingWindowEndAt = new Date(billing.windowEndAt);
  }

  let windowStartAt = existingWindowStartAt;
  let windowEndAt = existingWindowEndAt;
  let shouldResetBillingMonth = false;

  // Check if billing window has expired
  if (existingWindowEndAt && isBillingWindowExpired(existingWindowEndAt, now)) {
    // If window expired, recalculate and reset
    const newWindow = calculateBillingWindow(
      now,
      startDay,
      existingWindowStartAt
    );
    windowStartAt = newWindow.windowStartAt;
    windowEndAt = newWindow.windowEndAt;
    shouldResetBillingMonth = true;
  } else if (!existingWindowStartAt || !existingWindowEndAt) {
    // If no window exists, initialize calculation based on today's date
    const newWindow = calculateBillingWindow(now, startDay, null);
    windowStartAt = newWindow.windowStartAt;
    windowEndAt = newWindow.windowEndAt;
  }

  return {
    windowStartAt,
    windowEndAt,
    shouldResetBillingMonth
  };
}

/**
 * Update token usage and return update info
 * @typedef {Object} TokenUsageUpdateResult
 * @property {Object} usage - updated usage field values
 * @property {Object} billing - updated billing field values
 * @property {Array} addon_token - updated addon_token array
 */
async function updateTokenUsage(tenantId, tokenCount, options = {}) {
  try {
    const incrementMessageTotal = options.incrementMessageTotal === true;
    // skipTokenUsage: increase message.total only without deducting tenant/usage_* tokens or addons (e.g., unanswered)
    const skipTokenUsage = options.skipTokenUsage === true;
    const rawTokenCount = Number(tokenCount) || 0;
    const effectiveTokenCount = skipTokenUsage ? 0 : rawTokenCount;

    if (!tenantId) {
      return null;
    }
    if (!skipTokenUsage && rawTokenCount <= 0) {
      return null;
    }
    if (skipTokenUsage && !incrementMessageTotal) {
      return null;
    }

    const now = options.now || new Date();
    const timestamp = now.getTime();
    // Unify variable name to effective since existing logic uses tokenCount
    tokenCount = effectiveTokenCount;

    // Generate date info (usage_daily / same UTC as daily mail)
    const dateKey = toUtcDateKey(now); // "2024-01-15"
    const monthKey = toUtcMonthKey(now); // "2024-01"

    // Check and update billing window in a transaction
    // Declare variables to return updated values
    let updatedUsage = null;
    let updatedBilling = null;
    let updatedAddonToken = null;
    let tenantDocumentMissing = false;

    await store.runTransaction(async (transaction) => {
      const docRef = store.collection(Collection.TENANTS).doc(tenantId);
      const docSnap = await transaction.get(docRef);

      if (!docSnap.exists) {
        // Transaction callback may rerun, so external logging/Sentry should run once after completion
        tenantDocumentMissing = true;
        return;
      }

      const data = docSnap.data();
      const billing = data?.billing || {};
      const usage = data?.usage || {};
      const quota = data?.quota || {};

      // Calculate billing window (using reusable function)
      const billingWindowResult = calculateBillingWindowForTenant(billing, now);
      const windowStartAt = billingWindowResult.windowStartAt;
      const windowEndAt = billingWindowResult.windowEndAt;
      const shouldResetBillingMonth =
        billingWindowResult.shouldResetBillingMonth;

      // Generate billingKey
      const billingKey = generateBillingKey(windowStartAt, windowEndAt);

      // Firestore transaction rule: perform all reads before writes
      const dailyRef = store
        .collection(Collection.TENANTS)
        .doc(tenantId)
        .collection(Collection.USAGE_DAILY)
        .doc(dateKey);
      const monthlyRef = store
        .collection(Collection.TENANTS)
        .doc(tenantId)
        .collection(Collection.USAGE_MONTHLY)
        .doc(monthKey);
      const billingRef = store
        .collection(Collection.TENANTS)
        .doc(tenantId)
        .collection(Collection.USAGE_BILLING)
        .doc(billingKey);
      const [dailySnap, monthlySnap, billingSnap] = await Promise.all([
        transaction.get(dailyRef),
        transaction.get(monthlyRef),
        transaction.get(billingRef)
      ]);

      // Check date/month initialization
      const lastUpdatedDate = usage?.lastUpdatedDate; // Format "2024-01-15"
      const lastUpdatedMonth = usage?.lastUpdatedMonth; // Format "2024-01"

      // Check if date changed (if lastUpdatedDate exists and differs from today)
      const shouldResetToday = lastUpdatedDate && lastUpdatedDate !== dateKey;
      // Check if month changed (if lastUpdatedMonth exists and differs from current month)
      const shouldResetMonth =
        lastUpdatedMonth && lastUpdatedMonth !== monthKey;

      // ✅ Calculate tokens after checking windowStartAt (consider shouldResetBillingMonth)
      // Check base plan limits
      const baseTokenLimit = quota.token_limit_month || Infinity;
      // If shouldResetBillingMonth is true, billing month resets to zero
      const currentTokenUsedBillingMonth = shouldResetBillingMonth
        ? 0
        : usage.token_used_billing_month || 0;

      // Calculate tokens available under base plan
      let usedFromBasePlan = 0;
      let remainingForAddon = tokenCount;

      if (baseTokenLimit !== Infinity) {
        // Tokens available within base plan limits
        // Add safeguard since currentTokenUsedBillingMonth may exceed baseTokenLimit due to concurrency
        const availableInBasePlan = Math.max(
          0,
          baseTokenLimit - currentTokenUsedBillingMonth
        );
        // Tokens to use from base plan (within limits, prevent negative)
        usedFromBasePlan = Math.max(
          0,
          Math.min(tokenCount, availableInBasePlan)
        );
        // Use addons for tokens exceeding base plan limit
        remainingForAddon = Math.max(0, tokenCount - usedFromBasePlan);
      } else {
        // If unlimited, use all from base plan
        usedFromBasePlan = tokenCount;
        remainingForAddon = 0;
      }

      // Process addon token array
      let addonTokenArray = Array.isArray(data?.addon_token)
        ? data.addon_token
        : [];

      // F5, F6: handle expiration and depletion
      let updatedAddonTokenArray = processAddonStatus(
        addonTokenArray,
        timestamp
      );

      // Deduct only the amount exceeding the base plan limit from the addon
      let usedFromAddon = 0;

      if (remainingForAddon > 0) {
        const addonResult = consumeAddonTokens(
          updatedAddonTokenArray,
          remainingForAddon,
          timestamp
        );
        usedFromAddon = addonResult.usedFromAddon; // Number of tokens used from the addon
        updatedAddonTokenArray = addonResult.updated; // Updated addon token array
        // Leave unused addon tokens as is (treated as limit exceeded)
      }

      // Set to empty array if updatedAddonTokenArray is missing or invalid
      if (!Array.isArray(updatedAddonTokenArray)) {
        updatedAddonTokenArray = [];
      }

      // Prepare data for update
      const updateData = {
        usage: {
          lastUpdatedDate: dateKey, // Save last update date
          lastUpdatedMonth: monthKey // Save last update month
        },
        billing: {
          ...billing,
          startDay:
            billing?.startDay != null ? billing.startDay : now.getDate(), // If startDay is null, set based on today's day of the month
          windowStartAt: windowStartAt.getTime(),
          windowEndAt: windowEndAt.getTime()
        },
        // F5, F6: Save updated addon token array (only when tokens are deducted)
        ...(skipTokenUsage ? {} : { addon_token: updatedAddonTokenArray })
      };

      // F4) Update base plan usage (only the amount used within base plan limit)
      // Ensure usedFromBasePlan does not become negative (to handle concurrency issues)
      const safeUsedFromBasePlan = Math.max(0, usedFromBasePlan);

      // skipTokenUsage: Do not modify token/addon/usage_* token fields (only message.total)
      if (!skipTokenUsage) {
      // Update token_used_today
      // Prevent race conditions on concurrent requests:
      // Use transaction atomicity to update lastUpdatedDate together
      // If two requests come simultaneously, one succeeds and the other retries
      // On retry, lastUpdatedDate is already updated, so treat as increment
      if (shouldResetToday) {
        // Reset if the date has changed
        // Due to transaction atomicity, only one concurrent request succeeds
        // The other retries and re-evaluates with the latest data
        updateData.usage.token_used_today = tokenCount;
      } else {
        // Always increment if the date is the same
        updateData.usage.token_used_today = FieldValue.increment(tokenCount);
      }

      // Update token_used_month
      // Prevent race conditions on concurrent requests:
      // Use transaction atomicity to update lastUpdatedMonth together
      if (shouldResetMonth) {
        // Reset if the month has changed
        // Due to transaction atomicity, only one concurrent request succeeds
        // The other retries and re-evaluates with the latest data
        updateData.usage.token_used_month = tokenCount;
      } else {
        // Always increment if the month is the same
        updateData.usage.token_used_month = FieldValue.increment(tokenCount);
      }

      // When billing month reset is needed
      if (shouldResetBillingMonth) {
        updateData.usage.token_used_billing_month = safeUsedFromBasePlan; // After reset, add only base plan usage
        // Token shortage email: reset flag to allow resending in new window
        if (data?.alarm?.tokenLowMailing === true) {
          updateData.alarm = {
            ...(data.alarm || {}),
            tokenLowMailingSent50ThisWindow: false,
            tokenLowMailingSent10ThisWindow: false,
          };
        }
      } else {
        // Prevent decrease due to negative values
        if (safeUsedFromBasePlan > 0) {
          updateData.usage.token_used_billing_month =
            FieldValue.increment(safeUsedFromBasePlan);
        }
        // Do not update if safeUsedFromBasePlan is 0 (keep current value)
      }

      // F3) Update cumulative addon usage (for stats, never decrease)
      if (usedFromAddon > 0) {
        const currentAddonUsed = usage.token_used_addon_token || 0;
        updateData.usage.token_used_addon_token =
          currentAddonUsed + usedFromAddon;
      }
      } // end !skipTokenUsage (update token fields)

      // Calculate updated values for cache update
      const currentTokenUsedToday = usage.token_used_today || 0;
      const currentTokenUsedMonth = usage.token_used_month || 0;
      // currentTokenUsedBillingMonth is already declared at Line 169
      const currentTokenUsedAddonToken = usage.token_used_addon_token || 0;

      // Calculate updated usage values
      updatedUsage = skipTokenUsage
        ? {
            lastUpdatedDate: dateKey,
            lastUpdatedMonth: monthKey,
            token_used_today: currentTokenUsedToday,
            token_used_month: currentTokenUsedMonth,
            token_used_billing_month: currentTokenUsedBillingMonth,
            token_used_addon_token: currentTokenUsedAddonToken
          }
        : {
            lastUpdatedDate: dateKey,
            lastUpdatedMonth: monthKey,
            token_used_today: shouldResetToday
              ? tokenCount
              : currentTokenUsedToday + tokenCount,
            token_used_month: shouldResetMonth
              ? tokenCount
              : currentTokenUsedMonth + tokenCount,
            token_used_billing_month: shouldResetBillingMonth
              ? safeUsedFromBasePlan
              : currentTokenUsedBillingMonth + safeUsedFromBasePlan,
            token_used_addon_token:
              usedFromAddon > 0
                ? currentTokenUsedAddonToken + usedFromAddon
                : currentTokenUsedAddonToken
          };

      // Updated billing values
      // Use startDay calculated in calculateBillingWindowForTenant
      const calculatedStartDay =
        billing?.startDay != null ? billing.startDay : now.getDate();
      updatedBilling = {
        ...billing,
        startDay: calculatedStartDay,
        windowStartAt: windowStartAt.getTime(),
        windowEndAt: windowEndAt.getTime()
      };

      // Updated addon_token array
      updatedAddonToken = updatedAddonTokenArray;

      // 1. Update tenants/{tenant_id} document
      transaction.set(docRef, updateData, { merge: true });

      // 2. Create/update tenants/{tenant_id}/usage_daily/{dateKey} document
      // message.total is stored as a nested map to match the actual schema.
      const dailyPayload = {
        date_key: dateKey,
        month_key: monthKey,
        tenant_id: tenantId,
        updated_at: timestamp
      };
      if (!skipTokenUsage) {
        dailyPayload.tokens = {
          total: FieldValue.increment(tokenCount)
        };
      }
      if (incrementMessageTotal) {
        dailyPayload.message = {
          total: FieldValue.increment(1)
        };
      }
      if (!dailySnap.exists) {
        dailyPayload.created_at = timestamp;
      }
      transaction.set(dailyRef, dailyPayload, { merge: true });
      if (
        dailySnap.exists &&
        Object.prototype.hasOwnProperty.call(dailySnap.data() || {}, "message.total")
      ) {
        transaction.update(
          dailyRef,
          new FieldPath("message.total"),
          FieldValue.delete()
        );
      }

      // 3. Create/update document tenants/{tenant_id}/usage_monthly/{monthKey}
      const monthlyPayload = {
        month_key: monthKey,
        tenant_id: tenantId,
        updated_at: timestamp
      };
      if (!skipTokenUsage) {
        monthlyPayload.tokens = {
          total: FieldValue.increment(tokenCount)
        };
      }
      if (incrementMessageTotal) {
        monthlyPayload.message = {
          total: FieldValue.increment(1)
        };
      }
      if (!monthlySnap.exists) {
        monthlyPayload.created_at = timestamp;
      }
      transaction.set(monthlyRef, monthlyPayload, { merge: true });
      if (
        monthlySnap.exists &&
        Object.prototype.hasOwnProperty.call(monthlySnap.data() || {}, "message.total")
      ) {
        transaction.update(
          monthlyRef,
          new FieldPath("message.total"),
          FieldValue.delete()
        );
      }

      // 4. Create/update document tenants/{tenant_id}/usage_billing/{billingKey}
      // usage_billing stores total usage (base plan + add-ons).
      if (!skipTokenUsage) {
        const totalUsageForBilling = safeUsedFromBasePlan + usedFromAddon;

        const billingPayload = {
          billingKey,
          tokens: {
            total: FieldValue.increment(totalUsageForBilling)
          },
          windowStart: formatDateString(windowStartAt),
          windowEnd: formatDateString(windowEndAt),
          tenant_id: tenantId,
          updated_at: timestamp
        };
        if (!billingSnap.exists) {
          billingPayload.created_at = timestamp;
        }
        transaction.set(billingRef, billingPayload, { merge: true });
      }

      logInfo(
        `[updateTokenUsage] Token usage updated${shouldResetBillingMonth ? " (billing month 초기화됨)" : ""}${skipTokenUsage ? " (skipTokenUsage: message only)" : ""}`,
        {
          tenant_id: tenantId,
          function_name: "updateTokenUsage",
          extra: {
            token_count: tokenCount,
            raw_token_count: rawTokenCount,
            skip_token_usage: skipTokenUsage,
            increment_message_total: incrementMessageTotal,
            used_from_base_plan: usedFromBasePlan,
            used_from_addon: usedFromAddon,
            base_token_limit: baseTokenLimit,
            current_token_used_billing_month: currentTokenUsedBillingMonth,
            dateKey,
            monthKey,
            billingKey,
            shouldResetBillingMonth,
            purpose: options.purpose || null,
            step: options.step || null,
            batch_index: options.batch_index ?? null,
            batch_total: options.batch_total ?? null,
            leaf_index: options.leaf_index ?? null,
            leaf_total: options.leaf_total ?? null
          }
        }
      );
    });

    if (tenantDocumentMissing) {
      logWarn("[updateTokenUsage] Tenant 문서가 없음", {
        tenant_id: tenantId,
        function_name: "updateTokenUsage"
      });
      captureMessage(
        "[updateTokenUsage] Tenant document missing; token charge skipped",
        "warning",
        {
          tenant_id: tenantId || "unknown",
          function_name: "updateTokenUsage",
          tags: { alert_code: "token_usage_tenant_missing" },
          fingerprint: ["token_usage_tenant_missing", tenantId || "unknown"],
          extra: {
            token_count: tokenCount,
            skip_token_usage: skipTokenUsage,
            increment_message_total: incrementMessageTotal
          }
        }
      );
    }

    // Return updated value (for cache update).
    return {
      usage: updatedUsage,
      billing: updatedBilling,
      addon_token: updatedAddonToken
    };
  } catch (error) {
    logAndCaptureError(error, "[updateTokenUsage] Token usage update failed", {
      tenant_id: tenantId,
      function_name: "updateTokenUsage"
    });
    // Main process continues even if an error occurs.
    return null;
  }
}

// Add as a property to the function (for backward compatibility).
// updateTokenUsage() - callable directly as a function.
// updateTokenUsage.calculateBillingWindowForTenant - accessible as a property.
updateTokenUsage.calculateBillingWindowForTenant =
  calculateBillingWindowForTenant;
module.exports = updateTokenUsage;