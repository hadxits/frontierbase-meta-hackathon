/**
 * Elapsed time (seconds) rounded to one decimal place from HTTP handler start to now.
 * Used to record response delay when saving message subcollections.
 *
 * @param {number} requestStartedAtMs - Request start time based on Date.now()
 * @returns {number} Example: 1.523 → 1.5
 */
function elapsedResponseSeconds(requestStartedAtMs) {
  const t0 = Number(requestStartedAtMs);
  const base = Number.isFinite(t0) ? t0 : Date.now();
  const sec = (Date.now() - base) / 1000;
  return Math.round(sec * 10) / 10;
}

module.exports = { elapsedResponseSeconds };