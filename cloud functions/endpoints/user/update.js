const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const { auth } = require("@/firebase");
const ApiError = require("@/errors/apiError");
const { logAndCaptureError } = require("@/utils/logger");

const ALLOWED_UPDATE_KEY = "disabled";

/**
 * 사용자의 정보를 수정합니다.
 */
const updateUser = _onRequest({
  opts: {
    memory: "256MiB",
    maxInstances: 10,
    cpu: "gcf_gen1"
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      uid: { type: PropertyType.STRING },
      key: { type: PropertyType.STRING },
      val: {} //val can be any type
    },
    required: ["uid", "key", "val"]
  },
  handler: async (req) => {
    const { uid, key, val } = req.body;

    if (req.auth?.uid !== uid) {
      throw new ApiError({
        httpStatusCode: 403,
        errorCode: "FORBIDDEN",
        message: "Authenticated user does not match request uid.",
        returnToUser: true
      });
    }

    if (key !== ALLOWED_UPDATE_KEY) {
      throw new ApiError({
        httpStatusCode: 400,
        errorCode: "INVALID_UPDATE_FIELD",
        message: "Only account withdrawal can be updated.",
        returnToUser: true
      });
    }

    if (key === "disabled" && val !== true) {
      throw new ApiError({
        httpStatusCode: 400,
        errorCode: "INVALID_UPDATE_VALUE",
        message: "The disabled field can only be set to true.",
        returnToUser: true
      });
    }

    const r = await auth
      .updateUser(uid, {
        [key]: val
      })
      .then((re) => {
        return null;
      })
      .catch((error) => {
        return error;
      });

    if (r) {
      logAndCaptureError(
        r instanceof Error ? r : new Error(String(r?.message || r)),
        "[updateUser] Auth updateUser failed",
        {
          tenant_id: req.auth?.uid || uid || "unknown",
          function_name: "updateUser",
          extra: {
            uid,
            key,
            error_code: r.errorInfo?.code || r.code || null
          }
        }
      );
      throw new ApiError({
        httpStatusCode: 500,
        errorCode: r.errorInfo?.code ? r.errorInfo.code : r.code,
        message: r.errorInfo?.message ? r.errorInfo.message : r.message,
        returnToUser: true
      });
    }
  }
});

module.exports = updateUser;