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
 * 이메일로 RTDB `User` 노드에 해당 사용자가 있는지 조회합니다.
 * (`.indexOn`: `"email"` 등 RTDB 규칙이 있어야 `orderByChild` 쿼리가 동작합니다.)
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

    // RTDB에 없어도 Auth에만 남은 계정(탈퇴 등) 조회
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