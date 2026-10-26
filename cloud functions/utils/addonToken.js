/**
 * ============================================================================
 * addonToken.js - 애드온 토큰 관리 유틸리티
 * ============================================================================
 *
 * 애드온 토큰 배열(ledger) 기반 계산 및 관리 함수들
 *
 * [Runtime Calculation Formulas]
 * F1) 현재 애드온 "가용 여부"
 * F2) 현재 애드온 "잔액(사용 가능 토큰)"
 * F3) 애드온 사용 누적값(통계) - updateTokenUsage에서 처리
 * F4) 기본 플랜 사용량 - updateTokenUsage에서 처리
 * F5) 만료 처리
 * F6) 소진 처리
 */

const { logInfo, logWarn } = require("@/utils/logger");

/**
 * F1) 현재 애드온 "가용 여부" 확인
 *
 * @param {Array} addonTokenArray - addon_token 배열
 * @param {number} currentTime - 현재 시간 (timestamp, milliseconds)
 * @returns {boolean} - 애드온이 사용 가능한지 여부
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
 * F2) 현재 애드온 "잔액(사용 가능 토큰)" 계산
 *
 * @param {Array} addonTokenArray - addon_token 배열
 * @param {number} currentTime - 현재 시간 (timestamp, milliseconds)
 * @returns {number} - 사용 가능한 애드온 토큰 총합
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
 * F5) 만료 처리 - 만료된 애드온의 status를 "expired"로 변경
 *
 * @param {Array} addonTokenArray - addon_token 배열
 * @param {number} currentTime - 현재 시간 (timestamp, milliseconds)
 * @returns {Array} - 업데이트된 addon_token 배열 (변경사항이 있으면 새 배열 반환)
 */
function processAddonExpiration(addonTokenArray, currentTime = Date.now()) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0) {
    return addonTokenArray;
  }

  let hasChanges = false;
  const updated = addonTokenArray.map((addon) => {
    if (!addon) return addon;

    // 만료되었지만 아직 status가 "active"인 경우
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
 * F6) 소진 처리 - 소진된 애드온의 status를 "depleted"로 변경
 *
 * @param {Array} addonTokenArray - addon_token 배열
 * @returns {Array} - 업데이트된 addon_token 배열 (변경사항이 있으면 새 배열 반환)
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

    // 소진되었지만 아직 status가 "active"인 경우
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
 * 만료 및 소진 처리 (F5 + F6)
 *
 * @param {Array} addonTokenArray - addon_token 배열
 * @param {number} currentTime - 현재 시간 (timestamp, milliseconds)
 * @returns {Array} - 업데이트된 addon_token 배열
 */
function processAddonStatus(addonTokenArray, currentTime = Date.now()) {
  let updated = processAddonExpiration(addonTokenArray, currentTime);
  updated = processAddonDepletion(updated);
  return updated;
}

/**
 * 애드온 토큰 사용 처리
 * 활성 애드온 중에서 사용 가능한 토큰을 차감합니다.
 *
 * @param {Array} addonTokenArray - addon_token 배열
 * @param {number} tokenCount - 사용할 토큰 수
 * @param {number} currentTime - 현재 시간 (timestamp, milliseconds)
 * @returns {Object} - { updated: Array, usedFromAddon: number, remaining: number }
 *   - updated: 업데이트된 addon_token 배열
 *   - usedFromAddon: 애드온에서 실제로 사용한 토큰 수
 *   - remaining: 남은 토큰 수 (애드온에서 사용하지 못한 부분)
 */
function consumeAddonTokens(addonTokenArray, tokenCount, currentTime = Date.now()) {
  if (!Array.isArray(addonTokenArray) || addonTokenArray.length === 0 || tokenCount <= 0) {
    return {
      updated: addonTokenArray || [],
      usedFromAddon: 0,
      remaining: tokenCount
    };
  }

  // 활성이고 만료되지 않은 애드온만 필터링
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
      // 만료 시간이 빠른 순서대로 정렬 (FIFO)
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

  // 활성 애드온에서 순차적으로 차감
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
        // 소진되었으면 status 업데이트
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