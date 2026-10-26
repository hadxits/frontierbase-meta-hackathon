const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const requestTraceStorage = new AsyncLocalStorage();

const TRACE_PREFIX_RE = /^\[[0-9a-f]{6,16}\]/i;

/**
 * HTTP 요청 단위 로그 상관 ID (8자 hex).
 * @param {string} [seed] - x-request-trace-id 등 외부 시드 (선택)
 * @returns {string}
 */
function generateRequestTraceId(seed) {
  const trimmed = seed != null ? String(seed).trim() : "";
  if (trimmed) {
    return trimmed.replace(/[^0-9a-zA-Z_-]/g, "").slice(0, 16) || crypto.randomBytes(4).toString("hex");
  }
  return crypto.randomBytes(4).toString("hex");
}

/**
 * @returns {string|null}
 */
function getRequestTraceId() {
  return requestTraceStorage.getStore() || null;
}

/**
 * @param {string} message
 * @param {string|null} [traceId]
 * @returns {string}
 */
function formatTraceLogMessage(message, traceId = getRequestTraceId()) {
  const msg = String(message ?? "");
  if (!traceId || TRACE_PREFIX_RE.test(msg)) {
    return msg;
  }
  return `[${traceId}]${msg}`;
}

/**
 * @param {string} traceId
 * @param {() => T | Promise<T>} fn
 * @returns {T | Promise<T>}
 */
function runWithRequestTrace(traceId, fn) {
  const id = generateRequestTraceId(traceId);
  return requestTraceStorage.run(id, fn);
}

module.exports = {
  generateRequestTraceId,
  getRequestTraceId,
  formatTraceLogMessage,
  runWithRequestTrace
};