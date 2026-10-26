/**
 * ============================================================================
 * logger.js - 로깅 유틸리티 (tenant_id 필수)
 * ============================================================================
 *
 * 모든 로그는 tenant_id를 필수로 포함합니다.
 *
 * Sentry 정책:
 * - logOperationalWarn / logError: Cloud Logging만 (Sentry 미전송)
 * - logAndCaptureError: 예상 가능한 ApiError(returnToUser) 제외, critical만 Sentry
 *
 * 환경변수 제어:
 * - ENABLE_INFO_LOGS: info/warn 로그 활성화 여부 (기본값: true)
 *   - logOperationalWarn은 항상 출력 (운영 추적용)
 *   - error 로그는 항상 활성화됨
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

// 환경변수로 info/warn 로그 제어 (기본값: true, 활성화)
const ENABLE_INFO_LOGS = environment.ENABLE_INFO_LOGS;

/**
 * @typedef {'info' | 'error' | 'warn' | 'debug'} LogLevel
 */

/**
 * @typedef {Object} LogContext
 * @property {string} tenant_id - 테넌트 ID (필수)
 * @property {string} [conversation_id] - 대화 ID
 * @property {string} [function_name] - 함수 이름
 * @property {Object} [extra] - 추가 정보
 */

/**
 * 클라이언트에 반환하지만 운영상 중대하여 Sentry로도 보낼 ApiError 코드
 * (returnToUser=true여도 인프라/데이터 파이프라인 장애)
 */
const SENTRY_CRITICAL_ERROR_CODES = new Set([
  "WORKER_ENQUEUE_FAILED",
  "INTERNAL_SERVER_ERROR"
]);

/**
 * 클라이언트에 반환하는 예상 ApiError (검증/한도/플랜 등) — Sentry 제외 대상
 * @param {unknown} error
 * @returns {boolean}
 */
function isOperationalError(error) {
  if (!(error instanceof ApiError) || error.returnToUser !== true) {
    return false;
  }
  // 사용자에게 보여주더라도 인프라 장애는 operational로 취급하지 않음
  if (error.errorCode && SENTRY_CRITICAL_ERROR_CODES.has(String(error.errorCode))) {
    return false;
  }
  return true;
}

/**
 * logAndCaptureError로 이미 Cloud Logging + Sentry 처리된 오류
 * @param {unknown} error
 * @returns {boolean}
 */
function isAlreadyCapturedError(error) {
  return error instanceof Error && error.sentryLogged === true;
}

/**
 * handler catch 등에서 Sentry 전송 여부
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
 * Info 레벨 로그 (tenant_id 필수)
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
 * Error 레벨 Cloud Logging (Sentry 미전송)
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
 * Warn 레벨 로그 (tenant_id 필수, ENABLE_INFO_LOGS 적용)
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
 * 예상 가능한 운영/비즈니스 오류 (한도 초과, 검증 실패 등)
 * Cloud Logging warn만 — Sentry 미전송, ENABLE_INFO_LOGS와 무관하게 항상 기록
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
 * Debug 레벨 로그 (tenant_id 필수)
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
 * Critical 오류 — Cloud Logging + Sentry (operational ApiError는 Sentry 제외)
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