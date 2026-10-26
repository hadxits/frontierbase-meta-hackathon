/**
 * ============================================================================
 * getSession.js - 5분 유효 ephemeral JWT 발급
 * ============================================================================
 *
 * apiGateway에서만 호출 (POST /session). _onRequest 미사용.
 * Authorization: Bearer <Server API Secret> 필수.
 * secret으로 tenant를 확정한 뒤 JWT에 tenant_id를 바인딩합니다.
 * conversation_id: tenant_id + user_id + project_id 기준 결정적 해시.
 * ============================================================================
 */
const crypto = require("crypto");
const { sign, TTL_SEC } = require("@/utils/ephemeralToken");
const {
  verifyServerApiSecretRequest
} = require("@/utils/serverApiSecret");
const ErrorCode = require("@/const/ErrorCode");
const { getCachedTenant, setCachedTenant } = require("@/utils/memoryCache");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");

const DEFAULT_PROJECT_ID = "default";

/** tenant 바인딩 세션은 tenant|user|project, 공개 세션은 기존 user|project */
function getConversationId(tenantId, userId, projectId) {
  const sub = userId || "anonymous";
  const prj = projectId || DEFAULT_PROJECT_ID;
  const seed = tenantId
    ? `${String(tenantId)}|${String(sub)}|${String(prj)}`
    : `${String(sub)}|${String(prj)}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

/**
 * @param {{ user_id?: string, project_id?: string, tenant_id?: string, bindTenant?: boolean }} input
 */
function buildChatSessionData({
  user_id,
  project_id,
  tenant_id,
  bindTenant = false
} = {}) {
  const hasUser = user_id != null && String(user_id).trim() !== "";
  const hasProject = project_id != null && String(project_id).trim() !== "";
  const tenantId = tenant_id != null ? String(tenant_id).trim() : "";

  const conversation_id =
    !hasUser && !hasProject
      ? ""
      : getConversationId(
          bindTenant ? tenantId : "",
          user_id || "anonymous",
          project_id || DEFAULT_PROJECT_ID
        );

  const sub = user_id || "anonymous";
  const prj = project_id || DEFAULT_PROJECT_ID;

  const payload = {
    sub,
    prj,
    cid: conversation_id,
    scope: ["rag:stream", "messages:read"]
  };

  if (bindTenant && tenantId) {
    payload.tenant_id = tenantId;
  }

  const expiresIn = TTL_SEC();
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  return {
    client_token: sign(payload),
    token_type: "Bearer",
    expires_in: expiresIn,
    expires_at: expiresAt,
    conversation_id,
    ...(bindTenant && tenantId ? { plugin_key: tenantId } : {})
  };
}

async function assertPaidTenant(tenantId) {
  const id = String(tenantId || "").trim();
  if (!id) return { ok: true };

  let tenant = getCachedTenant(id);
  if (!tenant) {
    const doc = await store.collection(Collection.TENANTS).doc(id).get();
    if (doc.exists) {
      tenant = doc.data();
      setCachedTenant(id, tenant);
    }
  }

  if (!tenant) {
    return {
      ok: false,
      status: 403,
      body: {
        status: "error",
        error: {
          code: ErrorCode.TENANT_INACTIVE,
          message: "Tenant is not available."
        }
      }
    };
  }

  const plan = String(tenant.plan || "FREE").toUpperCase();
  if (plan === "FREE") {
    return {
      ok: false,
      status: 403,
      body: {
        status: "error",
        error: {
          code: ErrorCode.FREE_PLAN_NOT_ALLOWED,
          message:
            "Session is not available for FREE plan. Please upgrade to a paid plan."
        }
      }
    };
  }

  return { ok: true };
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getSession(req, res) {
  const secretCheck = await verifyServerApiSecretRequest(req);
  if (!secretCheck.ok) {
    return res.status(secretCheck.status).json(secretCheck.body);
  }

  const planCheck = await assertPaidTenant(secretCheck.tenantId);
  if (!planCheck.ok) {
    return res.status(planCheck.status).json(planCheck.body);
  }

  const { user_id, project_id } = req.body || {};

  return res.status(200).json({
    status: "success",
    message: "Request successful",
    data: buildChatSessionData({
      user_id,
      project_id,
      tenant_id: secretCheck.tenantId,
      bindTenant: true
    })
  });
}

getSession.buildChatSessionData = buildChatSessionData;
getSession.getConversationId = getConversationId;

module.exports = getSession;