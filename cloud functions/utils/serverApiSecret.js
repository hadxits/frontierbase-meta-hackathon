const crypto = require("crypto");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const ApiError = require("@/errors/apiError");
const ErrorCode = require("@/const/ErrorCode");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { loadTenantMember } = require("@/utils/tenantMembership");

const MEMBER_ROLE_ADMIN = "admin";
const KEY_STATUS_ACTIVE = "active";
const KEY_STATUS_REVOKED = "revoked";
const KEY_PREFIX = "fb_sk";
const KEY_PREFIX_WITH_SEP = `${KEY_PREFIX}_`;
const MAX_ACTIVE_KEYS_PER_TENANT = 5;
const KEY_ID_BYTES = 8;
const SECRET_BYTES = 32;

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret), "utf8").digest("hex");
}

function maskSecret(secret) {
  const value = String(secret || "");
  if (value.length <= 16) return `${KEY_PREFIX}_••••`;
  return `${value.slice(0, 12)}••••${value.slice(-4)}`;
}

/**
 * Parse format fb_sk_{keyId}_{secretPart}.
 * @returns {{ keyId: string, secret: string } | null}
 */
function parseServerApiSecret(raw) {
  const value = String(raw || "").trim();
  if (!value.startsWith(KEY_PREFIX_WITH_SEP)) return null;
  const rest = value.slice(KEY_PREFIX_WITH_SEP.length);
  const sep = rest.indexOf("_");
  if (sep <= 0) return null;
  const keyId = rest.slice(0, sep).trim();
  const secretPart = rest.slice(sep + 1).trim();
  if (!keyId || !secretPart) return null;
  if (!/^[a-f0-9]+$/i.test(keyId)) return null;
  return { keyId, secret: value };
}

function generateServerApiSecret() {
  const keyId = crypto.randomBytes(KEY_ID_BYTES).toString("hex");
  const secretPart = crypto.randomBytes(SECRET_BYTES).toString("base64url");
  const secret = `${KEY_PREFIX}_${keyId}_${secretPart}`;
  return {
    keyId,
    secret,
    secretHash: hashSecret(secret),
    secretPrefix: maskSecret(secret)
  };
}

function hashesEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

async function assertActiveTenantAdmin(tenantId, uid, locale) {
  const member = await loadTenantMember(tenantId, uid);
  if (
    !member.exists ||
    member.role !== MEMBER_ROLE_ADMIN ||
    !member.isActive
  ) {
    throw new ApiError({
      errorCode: "SERVER_API_SECRET_FORBIDDEN",
      message: getLocalizedErrorMessage(locale, "SERVER_API_SECRET_FORBIDDEN"),
      httpStatusCode: 403,
      returnToUser: true
    });
  }
  return member;
}

function serverApiKeyRef(keyId) {
  return store.collection(Collection.SERVER_API_KEYS).doc(String(keyId));
}

async function countActiveKeysForTenant(tenantId) {
  const snap = await store
    .collection(Collection.SERVER_API_KEYS)
    .where("tenant_id", "==", String(tenantId))
    .where("status", "==", KEY_STATUS_ACTIVE)
    .count()
    .get();
  return snap.data().count;
}

function toPublicKeyRecord(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    tenant_id: data.tenant_id || null,
    secret_prefix: data.secret_prefix || null,
    status: data.status || null,
    created_by: data.created_by || null,
    created_at: data.created_at ?? null,
    revoked_at: data.revoked_at ?? null,
    revoked_by: data.revoked_by || null
  };
}

/**
 * Verify Server API Secret in Authorization Bearer.
 * @returns {{ ok: true, tenantId: string, keyId: string } | { ok: false, status: number, body: object }}
 */
async function verifyServerApiSecretRequest(req) {
  const auth =
    (req.headers && (req.headers.authorization || req.headers.Authorization)) ||
    "";
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      ok: false,
      status: 401,
      body: {
        error: {
          code: ErrorCode.MISSING_BEARER_TOKEN,
          message: "Missing bearer token"
        }
      }
    };
  }

  const parsed = parseServerApiSecret(match[1]);
  if (!parsed) {
    return {
      ok: false,
      status: 401,
      body: {
        error: {
          code: ErrorCode.INVALID_SERVER_API_SECRET,
          message: "Invalid Server API Secret"
        }
      }
    };
  }

  const snap = await serverApiKeyRef(parsed.keyId).get();
  if (!snap.exists) {
    return {
      ok: false,
      status: 401,
      body: {
        error: {
          code: ErrorCode.INVALID_SERVER_API_SECRET,
          message: "Invalid Server API Secret"
        }
      }
    };
  }

  const data = snap.data() || {};
  const tenantId = String(data.tenant_id || "").trim();
  const status = String(data.status || "").trim();
  const storedHash = String(data.secret_hash || "").trim();

  if (
    !tenantId ||
    status !== KEY_STATUS_ACTIVE ||
    !hashesEqual(storedHash, hashSecret(parsed.secret))
  ) {
    return {
      ok: false,
      status: 401,
      body: {
        error: {
          code: ErrorCode.INVALID_SERVER_API_SECRET,
          message: "Invalid Server API Secret"
        }
      }
    };
  }

  return {
    ok: true,
    tenantId,
    keyId: parsed.keyId
  };
}

/**
 * Determine final tenant_id by decoding JWT tenant claim and body.plugin_key.
 * - Use tenant_id from JWT if present. If plugin_key exists, it must match.
 * - If JWT lacks tenant_id (public /public/session), use body.plugin_key.
 * @returns {{ ok: true, tenantId: string|null } | { ok: false, status: number, body: object }}
 */
function resolveTenantIdFromClaims(decoded, pluginKey) {
  const claimTenant = String(decoded?.tenant_id || "").trim();
  const bodyTenant = pluginKey == null ? "" : String(pluginKey).trim();

  if (claimTenant) {
    if (bodyTenant && bodyTenant !== claimTenant) {
      return {
        ok: false,
        status: 403,
        body: {
          error: {
            code: ErrorCode.TENANT_MISMATCH,
            message: "plugin_key does not match the session tenant"
          }
        }
      };
    }
    return { ok: true, tenantId: claimTenant };
  }

  if (bodyTenant) {
    return { ok: true, tenantId: bodyTenant };
  }

  return { ok: true, tenantId: null };
}

module.exports = {
  KEY_STATUS_ACTIVE,
  KEY_STATUS_REVOKED,
  MAX_ACTIVE_KEYS_PER_TENANT,
  hashSecret,
  maskSecret,
  parseServerApiSecret,
  generateServerApiSecret,
  assertActiveTenantAdmin,
  serverApiKeyRef,
  countActiveKeysForTenant,
  toPublicKeyRecord,
  verifyServerApiSecretRequest,
  resolveTenantIdFromClaims
};
