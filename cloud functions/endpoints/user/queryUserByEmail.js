const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const { auth } = require("@/firebase");
const ApiError = require("@/errors/apiError");
const { findRtdbUserByEmail } = require("@/utils/rtdbUser");

async function getAuthUserMetaByUid(uid) {
  if (!uid) return { providers: [], disabled: false };

  try {
    const userRecord = await auth.getUser(uid);
    return {
      providers: (userRecord.providerData || [])
        .map((provider) => provider?.providerId)
        .filter(Boolean),
      disabled: !!userRecord.disabled
    };
  } catch (_err) {
    return { providers: [], disabled: false };
  }
}

/**
 * Query RTDB `User` node for user by email.
 * (`.indexOn`: RTDB rules like `"email"` must exist for `orderByChild` queries to work.)
 */
const queryUserByEmail = _onRequest({
  opts: {
    memory: "256MiB",
    maxInstances: 2,
    concurrency: 5
  },
  params: {
    type: PropertyType.OBJECT,
    properties: {
      email: { type: PropertyType.STRING, minLength: 1 }
    },
    required: ["email"],
    additionalProperties: false
  },
  handler: async (req) => {
    const email = String(req.body.email || "").trim();
    if (!email) {
      throw new ApiError({
        errorCode: "INVALID_EMAIL",
        message: "email은 비어 있을 수 없습니다.",
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const user = await findRtdbUserByEmail(email);
    if (user) {
      const { providers, disabled } = await getAuthUserMetaByUid(user.uid);
      return { exists: true, providers, disabled };
    }

    // Check for accounts only in Auth but not in RTDB (e.g., deleted accounts).
    try {
      const authUser = await auth.getUserByEmail(email);
      const providers = (authUser.providerData || [])
        .map((provider) => provider?.providerId)
        .filter(Boolean);
      return { exists: true, providers, disabled: !!authUser.disabled };
    } catch (err) {
      if (err?.code === "auth/user-not-found") {
        return { exists: false, providers: [], disabled: false };
      }
      throw err;
    }
  }
});

module.exports = queryUserByEmail;