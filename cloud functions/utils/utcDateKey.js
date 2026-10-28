/**
 * utcDateKey.js — common UTC calendar key for usage/analytics/daily emails.
 * Cloud Functions unify to UTC YYYY-MM-DD regardless of local server TZ.
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * @param {number|Date} [input=Date.now()]
 * @returns {string} YYYY-MM-DD (UTC)
 */
function toUtcDateKey(input = Date.now()) {
  const d = input instanceof Date ? input : new Date(input);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) {
    return toUtcDateKey(Date.now());
  }
  const utc = new Date(ms);
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

/**
 * @param {number|Date} [input=Date.now()]
 * @returns {string} YYYY-MM (UTC)
 */
function toUtcMonthKey(input = Date.now()) {
  const d = input instanceof Date ? input : new Date(input);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) {
    return toUtcMonthKey(Date.now());
  }
  const utc = new Date(ms);
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}`;
}

/**
 * UTC-based full day interval for yesterday.
 * @param {number} [nowMs=Date.now()]
 * @returns {{ dateKey: string, startMs: number, endMs: number }}
 */
function getYesterdayUtcRange(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const todayStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const startMs = todayStartMs - 24 * 60 * 60 * 1000;
  const endMs = todayStartMs;
  return {
    dateKey: toUtcDateKey(startMs),
    startMs,
    endMs,
  };
}

module.exports = {
  pad2,
  toUtcDateKey,
  toUtcMonthKey,
  getYesterdayUtcRange,
};
