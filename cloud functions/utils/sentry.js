/**
 * ============================================================================
 * sentry.js - Sentry 에러 추적 유틸리티
 * ============================================================================
 *
 * Sentry를 사용한 에러 추적 및 로깅을 제공합니다.
 * 모든 에러는 tenant_id를 포함하여 Sentry로 전송됩니다.
 * 들어오는 HTTP 메서드가 GET이면 전송하지 않습니다. Cloud Logging은 그대로입니다.
 * ============================================================================
 */

const { AsyncLocalStorage } = require("async_hooks");
const Sentry = require("@sentry/google-cloud-serverless");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

const httpMethodStorage = new AsyncLocalStorage();

function isInboundGet() {
    return String(httpMethodStorage.getStore() || "").toUpperCase() === "GET";
}

// Sentry DSN: 환경변수 SENTRY_DSN 우선, 없으면 기본값 사용
const SENTRY_DSN =
  process.env.SENTRY_DSN ||
  "https://fa1a000d18799d8be9a95722efc9647c@o4508380486893568.ingest.us.sentry.io/4510796815269888";

// Sentry 초기화
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
 * 에러 핸들러 미들웨어
 */
function sentryWrapper(fn) {
    return async (req, res) => {
        return httpMethodStorage.run(req?.method, async () => {
            const generationAtStart = captureGeneration;
            try {
                await fn(req, res); // 원래 함수 실행
            } catch (error) {
                // GET은 스캐너/브라우저 프로브가 대부분이므로 Sentry에 보내지 않습니다.
                if (!isInboundGet()) {
                    recordCapture(() => Sentry.captureException(error));
                }
            } finally {
                // 이벤트가 생성된 요청에서만 전송 완료를 기다려 정상 요청 지연을 피합니다.
                if (captureGeneration > generationAtStart) {
                    await flushSentry();
                }
            }
        });
    };
}

/**
 * 에러를 Sentry로 전송 (tenant_id 필수)
 *
 * @param {Error|string} error - 에러 객체 또는 에러 메시지
 * @param {Object} context - 컨텍스트 정보 (tenant_id 필수)
 * @param {string} context.tenant_id - 테넌트 ID (필수)
 * @param {string} [context.conversation_id] - 대화 ID
 * @param {string} [context.function_name] - 함수 이름
 * @param {Object} [context.extra] - 추가 정보
 */
function captureError(error, context = {}) {
    if (isInboundGet()) return;

    if (!context.tenant_id) {
        console.error("[Sentry] tenant_id is required for error tracking", {
            error: error?.message || String(error),
            context
        });
        // tenant_id가 없어도 Sentry에 전송 (경고 포함)
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
 * 메시지를 Sentry로 전송 (에러가 아닌 경우, tenant_id 필수)
 *
 * @param {string} message - 메시지
 * @param {string} level - 레벨 ('info', 'warning', 'error')
 * @param {Object} context - 컨텍스트 정보 (tenant_id 필수)
 * @param {string} context.tenant_id - 테넌트 ID (필수)
 * @param {string} [context.conversation_id] - 대화 ID
 * @param {string} [context.function_name] - 함수 이름
 * @param {Object} [context.extra] - 추가 정보
 * @param {Object} [context.tags] - 추가 Sentry tags (필터/검색용)
 * @param {string[]} [context.fingerprint] - 이슈 그룹핑 fingerprint
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