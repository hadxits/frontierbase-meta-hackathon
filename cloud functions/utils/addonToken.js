/**
 * ============================================================================
 * addonToken.js - Add-on token management utilities
 * ============================================================================
 *
 * Functions for calculating and managing add-on token arrays (ledger)
 *
 * [Runtime Calculation Formulas]
 * F1) Current add-on "availability"
 * F2) Current add-on "balance (available tokens)"
 * F3) Cumulative add-on usage (statistics) - handled in updateTokenUsage
 * F4) Basic plan usage - handled in updateTokenUsage
 * F5) Expiration handling
 * F6) Exhaustion handling
 */

const { logInfo, logWarn } = require("@/utils/logger");

/**
 * F1) Check current add-on "availability"
 *
 * @param {Array} addonTokenArray - Array of addon_token
 * @param {number} currentTime - Current time (timestamp, milliseconds)
 * @returns {boolean} - Whether the add-on is available for use
 */
function hasAddonAvailable(addonTokenArray, currentTime = Date.now()) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0) {
    return false;
  }

  return addonTokenArray.some((addon) => {
    if (!addon) return false;

    const isActive = addon.status === "active";
    const isNotExpired = addon.active_pack_expires_at &&
                         addon.active_pack_expires_at > currentTime;
    const hasBalance = (addon.token_balance || 0) - (addon.token_used || 0) > 0;

    return isActive && isNotExpired && hasBalance;
  });
}

/**
 * F2) Calculate current addon "balance (available tokens)"
 *
 * @param {Array} addonTokenArray - Array of addon_token
 * @param {number} currentTime - Current time (timestamp, milliseconds)
 * @returns {number} - Total available addon tokens
 */
function getAddonAvailableTokens(addonTokenArray, currentTime = Date.now()) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0) {
    return 0;
  }

  return addonTokenArray
    .filter((addon) => {
      if (!addon) return false;

      const isActive = addon.status === "active";
      const isNotExpired = addon.active_pack_expires_at &&
                           addon.active_pack_expires_at > currentTime;

      return isActive && isNotExpired;
    })
    .reduce((sum, addon) => {
      const balance = addon.token_balance || 0;
      const used = addon.token_used || 0;
      const available = Math.max(0, balance - used);
      return sum + available;
    }, 0);
}

/**
 * F5) Expiration handling - Change status of expired addons to "expired"
 *
 * @param {Array} addonTokenArray - Array of addon_token
 * @param {number} currentTime - Current time (timestamp, milliseconds)
 * @returns {Array} - Updated addon_token array (returns a new array if there are changes)
 */
function processAddonExpiration(addonTokenArray, currentTime = Date.now()) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0) {
    return addonTokenArray;
  }

  let hasChanges = false;
  const updated = addonTokenArray.map((addon) => {
    if (!addon) return addon;

    // Case where it has expired but status is still "active".
    if (addon.status === "active" &&
        addon.active_pack_expires_at &&
        addon.active_pack_expires_at <= currentTime) {
      hasChanges = true;
      return {
        ...addon,
        status: "expired",
        updated_at: currentTime
      };
    }

    return addon;
  });

  return hasChanges ? updated : addonTokenArray;
}

/**
 * F6) Depletion handling - Change status of depleted addons to "depleted"
 *
 * @param {Array} addonTokenArray - Array of addon_token
 * @returns {Array} - Updated addon_token array (returns a new array if there are changes)
 */
function processAddonDepletion(addonTokenArray) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0) {
    return addonTokenArray;
  }

  let hasChanges = false;
  const currentTime = Date.now();

  const updated = addonTokenArray.map((addon) => {
    if (!addon) return addon;

    const balance = addon.token_balance || 0;
    const used = addon.token_used || 0;

    // Case where it is used up but status is still "active".
    if (addon.status === "active" && used >= balance) {
      hasChanges = true;
      return {
        ...addon,
        status: "depleted",
        updated_at: currentTime
      };
    }

    return addon;
  });

  return hasChanges ? updated : addonTokenArray;
}

/**
 * Expiration and depletion handling (F5 + F6)
 *
 * @param {Array} addonTokenArray - Array of addon_token
 * @param {number} currentTime - Current time (timestamp, milliseconds)
 * @returns {Array} - Updated addon_token array
 */
function processAddonStatus(addonTokenArray, currentTime = Date.now()) {
  let updated = processAddonExpiration(addonTokenArray, currentTime);
  updated = processAddonDepletion(updated);
  return updated;
}

/**
 * Process addon token usage
 * Deduct available tokens from active add-ons.
 *
 * @param {Array} addonTokenArray - Array of addon_token
 * @param {number} tokenCount - Number of tokens to use
 * @param {number} currentTime - Current time (timestamp, milliseconds)
 * @returns {Object} - { updated: Array, usedFromAddon: number, remaining: number }
 *   - updated: updated addon_token array.
 *   - usedFromAddon: number of tokens actually used from the add-on.
 *   - remaining: remaining tokens (unused part of the add-on).
 */
function consumeAddonTokens(addonTokenArray, tokenCount, currentTime = Date.now()) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0 || tokenCount <= 0) {
    return {
      updated: addonTokenArray || [],
      usedFromAddon: 0,
      remaining: tokenCount
    };
  }

  // Filter only add-ons that are active and not expired.
  const activeAddons = addonTokenArray
    .map((addon, index) => ({ addon, index }))
    .filter(({ addon }) => {
      if (!addon) return false;
      const isActive = addon.status === "active";
      const isNotExpired = addon.active_pack_expires_at &&
                           addon.active_pack_expires_at > currentTime;
      const hasBalance = (addon.token_balance || 0) - (addon.token_used || 0) > 0;
      return isActive && isNotExpired && hasBalance;
    })
    .sort((a, b) => {
      // Sort by earliest expiration time (FIFO).
      const expiresA = a.addon.active_pack_expires_at || 0;
      const expiresB = b.addon.active_pack_expires_at || 0;
      return expiresA - expiresB;
    });

  if (activeAddons.length === 0) {
    return {
      updated: addonTokenArray,
      usedFromAddon: 0,
      remaining: tokenCount
    };
  }

  let remaining = tokenCount;
  let usedFromAddon = 0;
  const updated = [...addonTokenArray];

  // Deduct sequentially from active add-ons.
  for (const { addon, index } of activeAddons) {
    if (remaining <= 0) break;

    const balance = addon.token_balance || 0;
    const used = addon.token_used || 0;
    const available = balance - used;

    if (available > 0) {
      const toUse = Math.min(remaining, available);
      const newUsed = used + toUse;

      updated[index] = {
        ...addon,
        token_used: newUsed,
        updated_at: currentTime,
        // Update status if used up.
        status: newUsed >= balance ? "depleted" : addon.status
      };

      usedFromAddon += toUse;
      remaining -= toUse;
    }
  }

  return {
    updated,
    usedFromAddon,
    remaining
  };
}

module.exports = {
  hasAddonAvailable,
  getAddonAvailableTokens,
  processAddonExpiration,
  processAddonDepletion,
  processAddonStatus,
  consumeAddonTokens
};