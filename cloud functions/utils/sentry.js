/**
 * ============================================================================
 * sentry.js - Sentry error tracking utility.
 * ============================================================================
 *
 * Provides error tracking and logging using Sentry.
 * All errors are sent to Sentry including tenant_id.
 * Does not send if incoming HTTP method is GET. Cloud Logging remains unchanged.
 * ============================================================================
 */

const { AsyncLocalStorage } = require("async_hooks");
const Sentry = require("@sentry/google-cloud-serverless");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

const httpMethodStorage = new AsyncLocalStorage();

function isInboundGet() {
    return String(httpMethodStorage.getStore() || "").toUpperCase() === "GET";
}

// Sentry DSN: uses environment variable SENTRY_DSN first, otherwise default value.
const SENTRY_DSN =
  process.env.SENTRY_DSN ||
  "https://fa1a000d18799d8be9a95722efc9647c@o4508380486893568.ingest.us.sentry.io/4510796815269888";

// Initialize Sentry.
Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [nodeProfilingIntegration()],
    // Tracing
    tracesSampleRate: 1.0 // Capture 100% of the transactions
});

let captureGeneration = 0;
let flushedGeneration = 0;

function recordCapture(captureFn) {
    captureGeneration += 1;
    return captureFn();
}

async function flushSentry(timeoutMs = 2000) {
    const targetGeneration = captureGeneration;
    if (targetGeneration <= flushedGeneration) return true;
    const flushed = await Sentry.flush(timeoutMs).catch(() => false);
    if (flushed) {
        flushedGeneration = Math.max(flushedGeneration, targetGeneration);
    }
    return flushed;
}

/**
 * Error handler middleware.
 */
function sentryWrapper(fn) {
    return async (req, res) => {
        return httpMethodStorage.run(req?.method, async () => {
            const generationAtStart = captureGeneration;
            try {
                await fn(req, res); // Execute original function.
            } catch (error) {
                // GET requests are mostly scanners/browser probes, so they are not sent to Sentry.
                if (!isInboundGet()) {
                    recordCapture(() => Sentry.captureException(error));
                }
            } finally {
                // Waits for send completion only on requests that generated the event to avoid delaying normal requests.
                if (captureGeneration > generationAtStart) {
                    await flushSentry();
                }
            }
        });
    };
}

/**
 * Send error to Sentry (tenant_id required).
 *
 * @param {Error|string} error - Error object or error message.
 * @param {Object} context - Context information (tenant_id required).
 * @param {string} context.tenant_id - Tenant ID (required).
 * @param {string} [context.conversation_id] - Conversation ID.
 * @param {string} [context.function_name] - Function name.
 * @param {Object} [context.extra] - Additional information.
 */
function captureError(error, context = {}) {
    if (isInboundGet()) return;

    if (!context.tenant_id) {
        console.error("[Sentry] tenant_id is required for error tracking", {
            error: error?.message || String(error),
            context
        });
        // Send to Sentry even without tenant_id (with warning).
        return recordCapture(() => Sentry.captureException(error, {
            tags: {
                missing_tenant_id: true
            },
            extra: context
        }));
    }

    const { tenant_id, conversation_id, function_name, extra = {} } = context;

    return recordCapture(() => Sentry.captureException(error, {
        tags: {
            tenant_id,
            function_name: function_name || "unknown",
            ...(conversation_id && { conversation_id })
        },
        user: {
            id: tenant_id
        },
        extra: {
            ...extra,
            tenant_id,
            ...(conversation_id && { conversation_id }),
            ...(function_name && { function_name })
        }
    }));
}

/**
 * Send message to Sentry (non-error, tenant_id required).
 *
 * @param {string} message - Message.
 * @param {string} level - Level ('info', 'warning', 'error').
 * @param {Object} context - Context information (tenant_id required).
 * @param {string} context.tenant_id - Tenant ID (required).
 * @param {string} [context.conversation_id] - Conversation ID.
 * @param {string} [context.function_name] - Function name.
 * @param {Object} [context.extra] - Additional information.
 * @param {Object} [context.tags] - Additional Sentry tags (for filtering/search).
 * @param {string[]} [context.fingerprint] - Issue grouping fingerprint.
 */
function captureMessage(message, level = "info", context = {}) {
    if (isInboundGet()) return;

    if (!context.tenant_id) {
        console.warn("[Sentry] tenant_id is required for message tracking", {
            message,
            level,
            context
        });
        return;
    }

    const {
        tenant_id,
        conversation_id,
        function_name,
        extra = {},
        tags = {},
        fingerprint
    } = context;

    return recordCapture(() => Sentry.captureMessage(message, {
        level,
        tags: {
            tenant_id,
            function_name: function_name || "unknown",
            ...(conversation_id && { conversation_id }),
            ...tags
        },
        user: {
            id: tenant_id
        },
        extra: {
            ...extra,
            tenant_id,
            ...(conversation_id && { conversation_id }),
            ...(function_name && { function_name })
        },
        ...(Array.isArray(fingerprint) && fingerprint.length > 0
            ? { fingerprint }
            : {})
    }));
}

module.exports = {
    Sentry,
    sentryWrapper,
    captureError,
    captureMessage,
    flushSentry
};