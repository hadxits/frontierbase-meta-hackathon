/**
 * Ephemeral JWT: /session 발급, /chat 진입 시 Bearer 검증
 * EPHEMERAL_JWT_SECRET(32바이트 이상 권장), EPHEMERAL_TTL_SEC(기본 5분)
 */
const jwt = require("jsonwebtoken");
const environment = require("@/env");
const ErrorCode = require("@/const/ErrorCode");

const SECRET = () => environment.EPHEMERAL_JWT_SECRET;
const TTL_SEC = () => environment.EPHEMERAL_TTL_SEC;

/** 5분짜리 client_token 발급용 payload 생성 후 서명 */
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
 * Authorization: Bearer <token> 검증. /chat 진입 시 사용.
 * @param {object} req - request (req.headers.authorization)
 * @param {string} [requiredScope] - 예: "rag:stream"
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