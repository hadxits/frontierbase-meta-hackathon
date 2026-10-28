/**
 * ============================================================================
 * logger.js - Logging utility (tenant_id required).
 * ============================================================================
 *
 * All logs must include tenant_id.
 *
 * Sentry policy:
 * - logOperationalWarn / logError: Cloud Logging only (do not send to Sentry).
 * - logAndCaptureError: Only critical errors are sent to Sentry, excluding expected ApiErrors (returnToUser).
 *
 * Control via environment variables:
 * - ENABLE_INFO_LOGS: Enable info/warn logs (default: true)
 *   - logOperationalWarn always outputs (for operational tracing)
 *   - Error logs are always enabled
 * ============================================================================
 */

const { logger } = require("firebase-functions/v2");
const { captureError } = require("@/utils/sentry");
const ApiError = require("@/errors/apiError");
const environment = require("@/env");
const {
  formatTraceLogMessage,
  getRequestTraceId
} = require("@/utils/requestTrace");

// Control info/warn logs via environment variable (default: true, enabled)
const ENABLE_INFO_LOGS = environment.ENABLE_INFO_LOGS;

/**
 * @typedef {'info' | 'error' | 'warn' | 'debug'} LogLevel
 */

/**
 * @typedef {Object} LogContext
 * @property {string} tenant_id - Tenant ID (required)
 * @property {string} [conversation_id] - Conversation ID
 * @property {string} [function_name] - Function name
 * @property {Object} [extra] - Additional information
 */

/**
 * ApiError codes returned to client but critical enough to send to Sentry
 * (even if returnToUser=true, for infrastructure/data pipeline failures)
 */
const SENTRY_CRITICAL_ERROR_CODES = new Set([
  "WORKER_ENQUEUE_FAILED",
  "INTERNAL_SERVER_ERROR"
]);

/**
 * Expected ApiErrors returned to client (validation/limit/plan etc.) — excluded from Sentry
 * @param {unknown} error
 * @returns {boolean}
 */
function isOperationalError(error) {
  if (!(error instanceof ApiError) || error.returnToUser !== true) {
    return false;
  }
  // Infrastructure failures are not treated as operational even if shown to users
  if (error.errorCode && SENTRY_CRITICAL_ERROR_CODES.has(String(error.errorCode))) {
    return false;
  }
  return true;
}

/**
 * Errors already handled by logAndCaptureError with Cloud Logging + Sentry
 * @param {unknown} error
 * @returns {boolean}
 */
function isAlreadyCapturedError(error) {
  return error instanceof Error && error.sentryLogged === true;
}

/**
 * Whether to send to Sentry in handler catch etc.
 * @param {unknown} error
 * @returns {boolean}
 */
function shouldCaptureError(error) {
  return !isOperationalError(error) && !isAlreadyCapturedError(error);
}

/**
 * @param {Error} error
 * @returns {Error}
 */
function markErrorCaptured(error) {
  if (error instanceof Error) {
    error.sentryLogged = true;
  }
  return error;
}

/**
 * @param {string} message
 * @param {LogContext} context
 * @returns {{ message: string, context: LogContext }}
 */
function withRequestTrace(message, context) {
  const traceId = getRequestTraceId();
  if (!traceId) {
    return { message, context };
  }
  return {
    message: formatTraceLogMessage(message, traceId),
    context: { ...context, request_trace_id: traceId }
  };
}

/**
 * Info level logs (tenant_id required)
 * @param {string} message
 * @param {LogContext} context
 */
function logInfo(message, context) {
  if (!context?.tenant_id) {
    console.warn("[Logger] tenant_id is required", { message, context });
    return;
  }

  if (!ENABLE_INFO_LOGS) {
    return;
  }

  const traced = withRequestTrace(message, context);
  logger.info(traced.message, traced.context);
}

/**
 * Error level Cloud Logging (not sent to Sentry)
 * @param {string} message
 * @param {LogContext & {error?: Error}} context
 */
function logError(message, context) {
  if (!context?.tenant_id) {
    console.error("[Logger] tenant_id is required", { message, context });
    return;
  }

  const { error, ...logContext } = context;
  const traced = withRequestTrace(message, logContext);

  logger.error(traced.message, {
    ...traced.context,
    ...(error
      ? {
          error: error?.message || String(error),
          stack: error?.stack
        }
      : {})
  });
}

/**
 * Warn level logs (tenant_id required, respects ENABLE_INFO_LOGS)
 * @param {string} message
 * @param {LogContext} context
 */
function logWarn(message, context) {
  if (!context?.tenant_id) {
    console.warn("[Logger] tenant_id is required", { message, context });
    return;
  }

  if (!ENABLE_INFO_LOGS) {
    return;
  }

  const traced = withRequestTrace(message, context);
  logger.warn(traced.message, traced.context);
}

/**
 * Expected operational/business errors (limit exceeded, validation failure, etc.)
 * Cloud Logging warn only — not sent to Sentry, always logged regardless of ENABLE_INFO_LOGS
 * @param {string} message
 * @param {LogContext} context
 */
function logOperationalWarn(message, context) {
  if (!context?.tenant_id) {
    console.warn("[Logger] tenant_id is required", { message, context });
    return;
  }

  const traced = withRequestTrace(message, context);
  logger.warn(traced.message, traced.context);
}

/**
 * Debug level logs (tenant_id required)
 * @param {string} message
 * @param {LogContext} context
 */
function logDebug(message, context) {
  if (!context?.tenant_id) {
    console.debug("[Logger] tenant_id is required", { message, context });
    return;
  }

  const traced = withRequestTrace(message, context);
  logger.debug(traced.message, traced.context);
}

/**
 * Critical errors — Cloud Logging + Sentry (operational ApiErrors excluded from Sentry)
 * @param {Error} error
 * @param {string} message
 * @param {LogContext} context
 */
function logAndCaptureError(error, message, context) {
  if (!context?.tenant_id) {
    console.error("[Logger] tenant_id is required", { error, message, context });
    return;
  }

  if (isAlreadyCapturedError(error)) {
    return;
  }

  const traced = withRequestTrace(message, context);

  logger.error(traced.message, {
    ...traced.context,
    error: error?.message || String(error),
    stack: error?.stack
  });

  if (isOperationalError(error)) {
    return;
  }

  captureError(error instanceof Error ? error : new Error(String(error)), {
    tenant_id: traced.context.tenant_id,
    conversation_id: traced.context.conversation_id,
    function_name: traced.context.function_name || traced.message,
    extra: {
      ...traced.context.extra,
      request_trace_id: traced.context.request_trace_id,
      log_message: traced.message
    }
  });

  markErrorCaptured(error instanceof Error ? error : new Error(String(error)));
}

module.exports = {
  logInfo,
  logError,
  logWarn,
  logOperationalWarn,
  logDebug,
  logAndCaptureError,
  isOperationalError,
  isAlreadyCapturedError,
  shouldCaptureError,
  markErrorCaptured
};