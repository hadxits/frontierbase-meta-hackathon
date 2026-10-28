/**
 * ============================================================================
 * apiGateway.js - single domain (api.frontierbase.io) path-based routing.
 * ============================================================================
 *
 * Connect https://api.frontierbase.io to this function via GCP domain mapping,
 * then route to sub-handlers based on path.
 *
 * Scanner requests (.env, web.config, swagger etc.) are still counted as one Cloud Run request.
 * To reduce calls, block at edge with Cloud Armor/CDN WAF etc.
 *
 * Cloudflare direct connection status is unclear from access logs alone, so for every request (except health checks)
 * Using `logInfo`, edge headers like CF-Ray and X-Forwarded-For are stored in `jsonPayload.extra`.
 *
 * - /chat, /chat/* → streamChatRag
 * - /messages → getChatMessages (message list by JWT tenant_id + conversation_id)
 * - /session, /session/* → getSession (backend only, Server API Secret required, no CORS)
 * - /public/session → session for www/support pages only (Origin + Referer restricted CORS)
 * - Others → 404
 *
 * Security/validation is done in each sub-handler (streamChatRag, getSession).
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

// VPC: internal resource access set to Direct VPC egress (private-ranges-only) in console/deployment.

// CORS: /chat, /messages, /public/session allow browser calls; /session is backend only.
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

/** CORS Origin allowed (excluding path — per browser Origin spec) */
const PUBLIC_SESSION_ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:4173",
  "https://www.frontierbase.io",
]);

/** Allow calls only from the /support page (Referer prefix). */
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

/** Only routes handled by this gateway return true (others like scanners or typos return 404 immediately). */
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

/** For tracking whether requests pass through Cloudflare or LB (field not available from run.googleapis.com/requests summary). */
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

/** Extract the token string from Authorization: Bearer <token>. */
function getBearerToken(req) {
  const auth = (req.headers && req.headers.authorization) || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/**
 * After JWT verification, bind conversation_id and tenant_id to the body.
 * @returns {null|object} Returns null if response was already sent on failure, otherwise does not return status result.
 *   Returns a failure object for verification/tenantResolution so the caller can early return.
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
    // Health check: immediately return 200 on GET with x-health-check header (same call pattern as other Cloud Functions).
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

      // Block FREE plan: return 403 if tenant's plan is FREE after lookup (uses cache).
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

      // If dataset_ids exist, convert to datasetIds and pass to streamChatRag.
      if (req.body.dataset_ids != null) req.body.datasetIds = req.body.dataset_ids;
      // Skip body decryption (pass plaintext). Determined by header in bodyDecryptionFilter.
      if (!req.headers) req.headers = {};
      req.headers["x-internal-gateway"] = "1";
      return streamChatRag(req, res);
    }
    if (isSessionPath(path)) {
      // No CORS headers → browser cross-origin requests are blocked. Only backend calls allowed.
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