const { onRequest } = require("firebase-functions/v2/https");
const Ajv = require("ajv");
const environment = require("@/env");
const applySecurityFilter = require("@/security/applySecurityFilter");
const authenticateCredential = require("@/security/authenticateCredential");
const ApiError = require("@/errors/apiError");
const { encrypt } = require("@/utils/crypt");
const { sendStreamErrorResponse } = require("@/utils/sendStreamErrorResponse");
const logError = require("./errors/logError");
const ErrorInfo = require("./errors/ErrorInfo");
const { logger } = require("firebase-functions/v2");
const { sentryWrapper, captureError, captureMessage } = require("@/utils/sentry");
const { AppConfig } = require("@/const/AppConfig");
const {
  shouldCaptureError,
  markErrorCaptured
} = require("@/utils/logger");
const {
  generateRequestTraceId,
  runWithRequestTrace,
  formatTraceLogMessage,
  getRequestTraceId
} = require("@/utils/requestTrace");

const DEFAULT_HTTP_OPTIONS = {
  cors: [
    "https://frontierbase-console.web.app",
    "https://frontierbase-admin.web.app",
    "https://console.frontierbase.io",
    "https://cdn.frontierbase.io",
    "https://playground.frontierbase.io",
    "https://www.frontierbase.io",
    "http://localhost:5173",
    "http://localhost:9081",
  ],
  region: AppConfig.GCP_REGION,
  timeoutSeconds: 60,
  memory: "128MiB",
  maxInstances: 100
};

const ajv = new Ajv();

function resolveRequestTenantId(request) {
  const body = request?.body || {};
  const raw =
    body.tenant_id ||
    body.tenant ||
    request?.auth?.uid ||
    null;
  const tenantId = raw != null ? String(raw).trim() : "";
  return tenantId || "unknown";
}

function captureUnhandledRequestError(error, request, extra = {}) {
  if (!shouldCaptureError(error)) return;
  const err = error instanceof Error ? error : new Error(String(error));
  const tenantId = resolveRequestTenantId(request);
  const path = request?.path || request?.url || "unknown";
  captureError(err, {
    tenant_id: tenantId,
    function_name: String(path).split("?")[0] || "unknown",
    extra: {
      error_code: error?.errorCode || null,
      http_status_code: error?.httpStatusCode || null,
      return_to_user:
        error instanceof ApiError ? error.returnToUser === true : null,
      method: request?.method || null,
      request_trace_id: getRequestTraceId() || null,
      ...extra
    }
  });
  markErrorCaptured(err);
}

const validateParams = (params, body) => {
  const valid = ajv.validate(params, body);
  if (!valid) {
    throw new ApiError({
      message: ajv.errorsText(),
      returnToUser: true,
    });
  }
};

/**
 *  _onRequest wraps firebase function's onRequest to add extra features.
 * @param opts httpOptions
 * @param params Schema for validating request body (ajv format)
 * @param handler Function to execute at the endpoint
 * @param enableSecurityFilter Option to enable security filter at each endpoint level
 * @param requireCredential
 * @param stream
 */
const _onRequest = ({
  opts = {},
  params = {},
  handler,
  enableSecurityFilter = true,
  requireCredential = false,
  stream = false
}) => {
  return onRequest(
    { ...DEFAULT_HTTP_OPTIONS, ...opts },
    sentryWrapper(async (request, response) => {
      // handle cron job call
      if (request.headers["wake-up"]) {
        logger.info("[health] wake-up probe", {
          probe: "wake-up",
          method: request.method,
          path: request.path,
          user_agent: request.get("user-agent") || null
        });
        return response.status(204).send();
      }

      // Uptime/Health check: GET + x-health-check returns 200 immediately without security filter (POST not needed)
      if (request.headers["x-health-check"]) {
        logger.info("[health] x-health-check probe", {
          probe: "x-health-check",
          method: request.method,
          path: request.path,
          user_agent: request.get("user-agent") || null
        });
        return response.status(200).json({ status: "ok" });
      }

      const body = request.body || {};
      const traceSeed =
        request.get("x-request-trace-id") ||
        request.get("x-fb-run-id") ||
        (body.conversation_id
          ? `${String(body.conversation_id).slice(-6)}${Date.now().toString(36).slice(-4)}`
          : null);

      await runWithRequestTrace(generateRequestTraceId(traceSeed), async () => {
        try {
          if (enableSecurityFilter) {
            await applySecurityFilter(request, response);
          }

          const traceId = getRequestTraceId();
          logger.debug(
            formatTraceLogMessage(
              `Received data: ${JSON.stringify(request.body)}`,
              traceId
            ),
            { request_trace_id: traceId }
          );

          request.auth = {
            isAuthenticated: false,
            uid: null,
            email: null,
            token: null
          };

          if (requireCredential) {
            await authenticateCredential(request);
          }

          validateParams(params, request.body || {});

          if (stream) {
            await handler(request, response);
            return;
          }

          const replyData = await handler(request, response);

          const hasAfterSend =
            replyData &&
            typeof replyData === "object" &&
            !Array.isArray(replyData) &&
            typeof replyData.afterSend === "function" &&
            Object.prototype.hasOwnProperty.call(replyData, "data");

          const payload = hasAfterSend ? replyData.data : replyData;

          const _encrypted =
            payload && environment.ENCRYPTION_ENABLED ? encrypt(payload) : payload;

          response.send({
            status: "success",
            message: "Request successful",
            data: _encrypted
          });

          if (hasAfterSend) {
            try {
              await replyData.afterSend();
            } catch (afterErr) {
              const traceId = getRequestTraceId();
              logger.warn(
                formatTraceLogMessage(
                  "[_onRequest] afterSend failed",
                  traceId
                ),
                {
                  request_trace_id: traceId,
                  error: afterErr?.message || String(afterErr),
                  stack: afterErr?.stack || null
                }
              );
              captureUnhandledRequestError(afterErr, request, {
                stage: "afterSend"
              });
            }
          }
        } catch (error) {
          const errorInfo = new ErrorInfo(error);
          logError(errorInfo);
          captureUnhandledRequestError(error, request, {
            stage: "handler"
          });

          /**
           * In stream mode, errors must be handled inside the handler.
           * Do not call response.send() because SSE headers may have already been sent.
           */
          if (stream) {
            const sent = sendStreamErrorResponse(response, error);
            if (!sent.sent) {
              const traceId = getRequestTraceId();
              logger.error(
                formatTraceLogMessage(
                  "[_onRequest] Failed to terminate stream error response",
                  traceId
                ),
                {
                  request_trace_id: traceId,
                  error: error?.message || String(error),
                  stack: error?.stack,
                  mode: sent.mode,
                  send_error: sent.error?.message || null,
                  headers_sent: !!response.headersSent,
                  writable_ended: !!response.writableEnded,
                  destroyed: !!response.destroyed,
                  writable: !!response.writable
                }
              );
              captureMessage(
                "[_onRequest] Failed to terminate stream error response",
                "error",
                {
                  tenant_id: resolveRequestTenantId(request),
                  function_name: String(request?.path || "stream").split("?")[0],
                  tags: { alert_code: "stream_error_terminate_failed" },
                  fingerprint: [
                    "stream_error_terminate_failed",
                    String(request?.path || "stream")
                  ],
                  extra: {
                    mode: sent.mode,
                    send_error: sent.error?.message || null,
                    headers_sent: !!response.headersSent,
                    original_error: error?.message || String(error)
                  }
                }
              );
            }
            return;
          }

          /**
           * Send error to the user.
           * If ApiError and returnToUser is true, send error details to the user.
           * If ApiError with returnToUser false or unexpected error occurs, hide error message from user.
           */
          if (error instanceof ApiError) {
            if (error.returnToUser) {
              const errorBody = {
                status: "error",
                errorCode: error.errorCode,
                message: error.message
              };
              if (error.data != null) {
                errorBody.details = error.data;
              }
              response.status(error.httpStatusCode).send(errorBody);
            } else {
              response.status(error.httpStatusCode).send({
                status: "error",
                errorCode: "INVALID_REQUEST",
                message: "Invalid request."
              });
            }
          } else {
            response.status(500).send({
              status: "error",
              errorCode: "INTERNAL_SERVER_ERROR",
              message:
                "Request failed. Please try again later or contact support."
            });
          }
        }
      });
    })
  );
};

module.exports = _onRequest;