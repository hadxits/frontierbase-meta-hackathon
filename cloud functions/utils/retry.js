/**
 * Simple retry helpers for HTTP/API calls.
 * Used to handle transient 429 (rate limit) responses from upstream APIs.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry once when the thrown error is an Axios error with HTTP 429.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ waitMs?: number }} [options]
 * @returns {Promise<T>}
 */
async function retryOnceOn429(fn, options = {}) {
  const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : 2000;
  try {
    return await fn();
  } catch (err) {
    if (err?.response?.status === 429) {
      await sleep(waitMs);
      return await fn();
    }
    throw err;
  }
}

module.exports = {
  retryOnceOn429,
};