/**
 * Ephemeral JWT: Issue at /session, verify Bearer on /chat entry
 * EPHEMERAL_JWT_SECRET (recommended 32 bytes or more), EPHEMERAL_TTL_SEC (default 5 minutes)
 */
const jwt = require("jsonwebtoken");
const environment = require("@/env");
const ErrorCode = require("@/const/ErrorCode");

const SECRET = () => environment.EPHEMERAL_JWT_SECRET;
const TTL_SEC = () => environment.EPHEMERAL_TTL_SEC;

/** Create and sign payload for 5-minute client_token issuance */
function sign(payload) {
  const secret = SECRET();
  if (!secret || secret.length < 32) {
    throw new Error("EPHEMERAL_JWT_SECRET is required and should be at least 32 bytes");
  }
  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    expiresIn: TTL_SEC()
  });
}

/**
 * Verify Authorization: Bearer <token>. Used on /chat entry.
 * @param {object} req - request (req.headers.authorization)
 * @param {string} [requiredScope] - e.g., "rag:stream"
 * @returns {{ ok: true, decoded } | { ok: false, status: number, body: object }}
 */
function verifyRequest(req, requiredScope) {
  const auth = (req.headers && req.headers.authorization) || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return {
      ok: false,
      status: 401,
      body: { error: { code: ErrorCode.MISSING_BEARER_TOKEN, message: "Missing bearer token" } }
    };
  }

  const token = m[1];
  const secret = SECRET();
  if (!secret) {
    return {
      ok: false,
      status: 500,
      body: { error: { code: ErrorCode.INVALID_TOKEN, message: "Invalid token" } }
    };
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    const scopes = decoded.scope || [];
    if (requiredScope && !scopes.includes(requiredScope)) {
      return {
        ok: false,
        status: 403,
        body: { error: { code: ErrorCode.INVALID_SCOPE, message: "Invalid scope" } }
      };
    }
    return { ok: true, decoded };
  } catch (e) {
    const isExpired = e && e.name === "TokenExpiredError";
    return {
      ok: false,
      status: 401,
      body: {
        error: {
          code: isExpired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.INVALID_TOKEN,
          message: isExpired ? "Token expired" : "Invalid token"
        }
      }
    };
  }
}

module.exports = {
  sign,
  verifyRequest,
  TTL_SEC
};