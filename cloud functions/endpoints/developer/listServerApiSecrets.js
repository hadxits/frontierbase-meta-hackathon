/**
 * Server API Secret list (original not included, only prefix/status).
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { loadAndValidateTenant } = require("@/utils/tenant");
const {
  assertActiveTenantAdmin,
  toPublicKeyRecord
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
      functionName: "listServerApiSecrets",
      requireQdrantUrl: false
    });
    await assertActiveTenantAdmin(tenantId, req.auth.uid, locale);

    const snap = await store
      .collection(Collection.SERVER_API_KEYS)
      .where("tenant_id", "==", tenantId)
      .orderBy("created_at", "desc")
      .limit(50)
      .get();

    const keys = snap.docs.map((doc) => toPublicKeyRecord(doc));

    return { keys };
  }
});
