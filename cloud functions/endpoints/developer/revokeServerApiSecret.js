/**
 * Server API Secret 폐기
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { loadAndValidateTenant } = require("@/utils/tenant");
const {
  KEY_STATUS_ACTIVE,
  KEY_STATUS_REVOKED,
  assertActiveTenantAdmin,
  serverApiKeyRef
} = require("@/utils/serverApiSecret");

module.exports = _onRequest({
  opts: {
    memory: "256MiB",
    timeoutSeconds: 60,
    maxInstances: 5,
    cpu: "gcf_gen1"
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant_id: { type: PropertyType.STRING },
      key_id: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING }
    },
    required: ["tenant_id", "key_id"],
    additionalProperties: false
  },
  handler: async (req) => {
    const tenantId = String(req.body.tenant_id || "").trim();
    const keyId = String(req.body.key_id || "").trim();
    const locale = String(req.body.locale || "en").trim() || "en";

    await loadAndValidateTenant(tenantId, {
      locale,
      functionName: "revokeServerApiSecret",
      requireQdrantUrl: false
    });
    await assertActiveTenantAdmin(tenantId, req.auth.uid, locale);

    const ref = serverApiKeyRef(keyId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new ApiError({
        errorCode: "SERVER_API_SECRET_NOT_FOUND",
        message: getLocalizedErrorMessage(
          locale,
          "SERVER_API_SECRET_NOT_FOUND"
        ),
        httpStatusCode: 404,
        returnToUser: true
      });
    }

    const data = snap.data() || {};
    if (String(data.tenant_id || "") !== tenantId) {
      throw new ApiError({
        errorCode: "SERVER_API_SECRET_FORBIDDEN",
        message: getLocalizedErrorMessage(
          locale,
          "SERVER_API_SECRET_FORBIDDEN"
        ),
        httpStatusCode: 403,
        returnToUser: true
      });
    }

    if (String(data.status || "") === KEY_STATUS_REVOKED) {
      return {
        revoked: true,
        id: keyId,
        status: KEY_STATUS_REVOKED,
        revoked_at: data.revoked_at ?? null
      };
    }

    if (String(data.status || "") !== KEY_STATUS_ACTIVE) {
      throw new ApiError({
        errorCode: "SERVER_API_SECRET_NOT_FOUND",
        message: getLocalizedErrorMessage(
          locale,
          "SERVER_API_SECRET_NOT_FOUND"
        ),
        httpStatusCode: 404,
        returnToUser: true
      });
    }

    const now = Date.now();
    await ref.update({
      status: KEY_STATUS_REVOKED,
      revoked_at: now,
      revoked_by: req.auth.uid
    });

    return {
      revoked: true,
      id: keyId,
      status: KEY_STATUS_REVOKED,
      revoked_at: now
    };
  }
});
