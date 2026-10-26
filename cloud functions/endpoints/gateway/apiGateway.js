/**
 * ============================================================================
 * apiGateway.js - 단일 도메인(api.frontierbase.io) 경로 기반 라우팅
 * ============================================================================
 *
 * GCP 도메인 매핑으로 https://api.frontierbase.io 를 이 함수에 연결한 뒤,
 * path에 따라 하위 핸들러로 분기합니다.
 *
 * 스캐너(.env, web.config, swagger 등) 요청은 여전히 Cloud Run “요청 1건”으로
 * 집계됩니다. 호출 자체를 줄이려면 Cloud Armor / CDN WAF 등 엣지에서 차단하세요.
 *
 * Cloudflare 직결 여부 등은 access 로그 요약만으로 불명확하므로, 매 요청(헬스체크 제외)
 * `logInfo`로 CF-Ray·X-Forwarded-For 등 엣지 헤더를 `jsonPayload.extra`에 남깁니다.
 *
 * - /chat, /chat/* → streamChatRag
 * - /messages → getChatMessages (JWT tenant_id + conversation_id 기준 메시지 목록)
 * - /session, /session/* → getSession (백엔드 전용, Server API Secret 필수, CORS 없음)
 * - /public/session → www /support 페이지 전용 session (Origin + Referer 제한 CORS)
 * - 그 외 → 404
 *
 * 보안/검증은 각 하위 핸들러(streamChatRag, getSession)에서 수행합니다.
 * ============================================================================
 */
const { onRequest } = require("firebase-functions/v2/https");
const { sentryWrapper } = require("@/utils/sentry");

const streamChatRag = require("@/endpoints/ai/streamChatRag");
const getChatMessages = require("@/endpoints/ai/getChatMessages");
const getSession = require("@/endpoints/session/getSession");
const { verifyRequest } = require("@/utils/ephemeralToken");
const { resolveTenantIdFromClaims } = require("@/utils/serverApiSecret");
const ErrorCode = require("@/const/ErrorCode");
const { getCachedTenant, setCachedTenant } = require("@/utils/memoryCache");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { logInfo } = require("@/utils/logger");
const { AppConfig } = require("@/const/AppConfig");

// VPC: 내부 리소스 접근은 콘솔/배포 시 Direct VPC egress로 설정 (private-ranges-only)

// CORS: /chat, /messages, /public/session 은 브라우저 호출 허용. /session 은 백엔드 전용.
const STREAM_CHAT_GATEWAY_TIMEOUT_SECONDS = 90;

const DEFAULT_HTTP_OPTIONS = {
  cors: false,
  region: AppConfig.GCP_REGION,
  timeoutSeconds: STREAM_CHAT_GATEWAY_TIMEOUT_SECONDS,
  memory: "512MiB",
  maxInstances: 20,
  concurrency: 4
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function getPath(req) {
  const raw = req.url || req.path || "";
  return raw.split("?")[0].replace(/\/+$/, "") || "/";
}

function isChatPath(path) {
  return path === "/chat" || path.startsWith("/chat/");
}

function isMessagesPath(path) {
  return path === "/messages" || path.startsWith("/messages/");
}

const PUBLIC_WWW_SUPPORT_PROJECT_ID = "www-support";

/** CORS Origin 허용 (path 미포함 — 브라우저 Origin 스펙) */
const PUBLIC_SESSION_ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:4173",
  "https://www.frontierbase.io",
]);

/** /support 페이지에서만 호출 허용 (Referer prefix) */
const PUBLIC_SESSION_ALLOWED_REFERER_PREFIXES = [
  "http://localhost:5173/support",
  "http://localhost:4173/support",
  "https://www.frontierbase.io/support",
];

function getRequestHeader(req, name) {
  const value = req.headers?.[name];
  if (value == null) return "";
  return String(Array.isArray(value) ? value[0] : value).trim();
}

function isAllowedPublicSessionOrigin(req) {
  return PUBLIC_SESSION_ALLOWED_ORIGINS.has(getRequestHeader(req, "origin"));
}

function isAllowedPublicSessionReferer(req) {
  const referer = getRequestHeader(req, "referer");
  if (!referer) return false;
  return PUBLIC_SESSION_ALLOWED_REFERER_PREFIXES.some((prefix) =>
    referer.startsWith(prefix)
  );
}

function applyPublicSessionCors(req, res) {
  const origin = getRequestHeader(req, "origin");
  if (PUBLIC_SESSION_ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function rejectPublicSession(req, res, message) {
  applyPublicSessionCors(req, res);
  return res.status(403).json({
    status: "error",
    errorCode: "PUBLIC_SESSION_FORBIDDEN",
    message,
  });
}

function isPublicSessionPath(path) {
  return path === "/public/session" || path.startsWith("/public/session/");
}

function isSessionPath(path) {
  return path === "/session" || path.startsWith("/session/");
}

/** 이 게이트웨이가 라우팅하는 경로만 true (그 외는 스캐너·오타 등 → 즉시 404) */
function isRoutedApiPath(path) {
  return (
    isChatPath(path) ||
    isMessagesPath(path) ||
    isSessionPath(path) ||
    isPublicSessionPath(path)
  );
}

function isGatewayHealthCheck(req) {
  return req.method === "GET" && req.headers && req.headers["x-health-check"];
}

/** Cloudflare / LB 경유 여부 추적용 (run.googleapis.com/requests 요약만으로는 알 수 없는 필드) */
function buildGatewayEdgeLogExtra(req, path) {
  const h = req.headers || {};
  const pick = (name) => {
    const v = h[name];
    if (v == null) return "";
    return String(Array.isArray(v) ? v[0] : v).trim();
  };
  const trunc = (s, max) => {
    const str = String(s || "");
    if (str.length <= max) return str;
    return `${str.slice(0, max)}…`;
  };
  const cfRay = pick("cf-ray");
  return {
    request_method: req.method,
    request_path: path,
    host: pick("host"),
    user_agent: trunc(pick("user-agent"), 400),
    cf_ray: cfRay,
    cf_connecting_ip: pick("cf-connecting-ip"),
    true_client_ip: pick("true-client-ip"),
    x_forwarded_for: trunc(pick("x-forwarded-for"), 512),
    x_real_ip: pick("x-real-ip"),
    forwarded: trunc(pick("forwarded"), 400),
    via_cloudflare_proxy: Boolean(cfRay),
    socket_remote_address: req.socket?.remoteAddress || "",
    routed_api_path: isRoutedApiPath(path),
  };
}

function applyCors(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

function handlePublicChatSession(req, res) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const user_id = String(body.user_id || body.visitor_id || "").trim();
  const project_id =
    String(body.project_id || "").trim() || PUBLIC_WWW_SUPPORT_PROJECT_ID;

  return res.status(200).json({
    status: "success",
    message: "Request successful",
    data: getSession.buildChatSessionData({
      user_id: user_id || undefined,
      project_id,
    }),
  });
}

/** Authorization: Bearer <token> 에서 토큰 문자열 추출 */
function getBearerToken(req) {
  const auth = (req.headers && req.headers.authorization) || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/**
 * JWT 검증 후 conversation_id / tenant_id 를 body에 바인딩.
 * @returns {null|object} 실패 시 이미 응답을 보낸 경우 null이 아닌 status 결과를 반환하지 않고
 *   호출부가 early return 하도록 verification/tenantResolution 실패 객체를 돌려준다.
 */
function bindSessionClaimsToBody(req, verification) {
  if (!req.body || typeof req.body !== "object") req.body = {};
  const tokenString = getBearerToken(req);
  if (verification.decoded && verification.decoded.cid) {
    req.body.conversation_id = verification.decoded.cid;
  } else if (tokenString) {
    req.body.conversation_id = tokenString;
  }

  const tenantResolution = resolveTenantIdFromClaims(
    verification.decoded,
    req.body.plugin_key
  );
  if (!tenantResolution.ok) {
    return tenantResolution;
  }

  if (tenantResolution.tenantId) {
    req.body.tenant_id = tenantResolution.tenantId;
    req.body.plugin_key = tenantResolution.tenantId;
  }

  return { ok: true, tenantId: tenantResolution.tenantId };
}

const apiGateway = onRequest(
  { ...DEFAULT_HTTP_OPTIONS },
  sentryWrapper(async (req, res) => {
    // Health check: GET + x-health-check 시 즉시 200 (다른 Cloud Function과 동일한 호출 형태)
    if (req.method === "GET" && req.headers["x-health-check"]) {
      return res.status(200).json({ status: "ok" });
    }

    const path = getPath(req);

    if (!isGatewayHealthCheck(req)) {
      logInfo("[apiGateway] Request edge / proxy headers", {
        tenant_id: "apigateway",
        function_name: "apiGateway",
        extra: buildGatewayEdgeLogExtra(req, path),
      });
    }

    if (req.method === "OPTIONS") {
      if (isPublicSessionPath(path)) {
        if (!isAllowedPublicSessionOrigin(req)) {
          return res.status(403).end();
        }
        applyPublicSessionCors(req, res);
        return res.status(204).send("");
      }
      if (isChatPath(path) || isMessagesPath(path)) {
        applyCors(res);
        return res.status(204).send("");
      }
      return res.status(204).send("");
    }

    if (!isRoutedApiPath(path)) {
      return res.status(404).end();
    }

    if (isMessagesPath(path)) {
      applyCors(res);
      const verification = verifyRequest(req, "rag:stream");
      if (!verification.ok) {
        return res.status(verification.status).json(verification.body);
      }
      const bindResult = bindSessionClaimsToBody(req, verification);
      if (!bindResult.ok) {
        return res.status(bindResult.status).json(bindResult.body);
      }
      return getChatMessages(req, res);
    }

    if (isChatPath(path)) {
      applyCors(res);
      const verification = verifyRequest(req, "rag:stream");
      if (!verification.ok) {
        return res.status(verification.status).json(verification.body);
      }
      const bindResult = bindSessionClaimsToBody(req, verification);
      if (!bindResult.ok) {
        return res.status(bindResult.status).json(bindResult.body);
      }

      // FREE 플랜 차단: tenant 조회 후 plan이 FREE이면 403 (캐시 사용)
      const tenantId = bindResult.tenantId;
      if (tenantId != null && String(tenantId).trim() !== "") {
        const id = String(tenantId).trim();

        let tenant = getCachedTenant(id);
        if (!tenant) {
          const doc = await store.collection(Collection.TENANTS).doc(id).get();
          if (doc.exists) {
            tenant = doc.data();
            setCachedTenant(id, tenant);
          }
        }

        if (tenant) {
          const plan = String(tenant.plan || "FREE").toUpperCase();
          if (plan === "FREE") {
            return res.status(403).json({
              status: "error",
              error: {
                code: ErrorCode.FREE_PLAN_NOT_ALLOWED,
                message:
                  "Chat is not available for FREE plan. Please upgrade to a paid plan.",
              },
            });
          }
        }
      }

      // dataset_ids가 있으면 datasetIds로 취환하여 streamChatRag에 전달
      if (req.body.dataset_ids != null) req.body.datasetIds = req.body.dataset_ids;
      // body 복호화 스킵(평문 전달). bodyDecryptionFilter에서 헤더로 판단
      if (!req.headers) req.headers = {};
      req.headers["x-internal-gateway"] = "1";
      return streamChatRag(req, res);
    }
    if (isSessionPath(path)) {
      // CORS 헤더 없음 → 브라우저 cross-origin 요청은 차단됨. 백엔드에서만 호출 가능.
      if (req.method !== "POST") {
        return res.status(405).json({
          status: "error",
          errorCode: "INVALID_HTTP_METHOD",
          message: "POST method is required.",
        });
      }
      if (!req.headers) req.headers = {};
      req.headers["x-internal-gateway"] = "1";
      return getSession(req, res);
    }
    if (isPublicSessionPath(path)) {
      if (!isAllowedPublicSessionOrigin(req)) {
        return rejectPublicSession(req, res, "Origin is not allowed.");
      }
      if (req.method !== "POST") {
        applyPublicSessionCors(req, res);
        return res.status(405).json({
          status: "error",
          errorCode: "INVALID_HTTP_METHOD",
          message: "POST method is required.",
        });
      }
      if (!isAllowedPublicSessionReferer(req)) {
        return rejectPublicSession(
          req,
          res,
          "This endpoint is only available from the /support page."
        );
      }
      applyPublicSessionCors(req, res);
      return handlePublicChatSession(req, res);
    }

    return res.status(404).end();
  })
);

module.exports = apiGateway;