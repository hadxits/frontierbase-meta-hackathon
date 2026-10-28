/**
 * Server API Secret creation (original returns once in response, only hash stored in DB).
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { loadAndValidateTenant } = require("@/utils/tenant");
const {
  KEY_STATUS_ACTIVE,
  MAX_ACTIVE_KEYS_PER_TENANT,
  generateServerApiSecret,
  assertActiveTenantAdmin,
  serverApiKeyRef,
  countActiveKeysForTenant
} = require("@/utils/serverApiSecret");

module.exports = _onRequest({
  opts: {
    memory: "256MiB",
    timeoutSeconds: 60,
    maxInstances: 20,
    cpu: "gcf_gen1"
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant_id: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING }
    },
    required: ["tenant_id"],
    additionalProperties: false
  },
  handler: async (req) => {
    const tenantId = String(req.body.tenant_id || "").trim();
    const locale = String(req.body.locale || "en").trim() || "en";

    await loadAndValidateTenant(tenantId, {
      locale,
      functionName: "createServerApiSecret",
      requireQdrantUrl: false
    });
    await assertActiveTenantAdmin(tenantId, req.auth.uid, locale);

    const activeCount = await countActiveKeysForTenant(tenantId);
    if (activeCount >= MAX_ACTIVE_KEYS_PER_TENANT) {
      throw new ApiError({
        errorCode: "SERVER_API_SECRET_LIMIT",
        message: getLocalizedErrorMessage(locale, "SERVER_API_SECRET_LIMIT"),
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const generated = generateServerApiSecret();
    const now = Date.now();
    await serverApiKeyRef(generated.keyId).create({
      id: generated.keyId,
      tenant_id: tenantId,
      secret_hash: generated.secretHash,
      secret_prefix: generated.secretPrefix,
      status: KEY_STATUS_ACTIVE,
      created_by: req.auth.uid,
      created_at: now,
      revoked_at: null,
      revoked_by: null
    });

    return {
      id: generated.keyId,
      secret: generated.secret,
      secret_prefix: generated.secretPrefix,
      status: KEY_STATUS_ACTIVE,
      created_at: now,
      created_by: req.auth.uid
    };
  }
});
