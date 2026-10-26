const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const { db, store } = require("@/firebase");
const ApiError = require("@/errors/apiError");
const Collection = require("@/const/firestore/Collection");
const {
  sendTemplateEmailFromBody
} = require("@/endpoints/email/sendTemplateEmail");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logAndCaptureError } = require("@/utils/logger");
const {
  persistGoogleProfilePhotoIfNeeded
} = require("@/utils/persistGoogleProfilePhoto");

const RTDB_USER_ROOT = "User";

/**
 * RTDB 키 세그먼트로 쓸 uid에 금지 문자(`.#$/[]`)가 없는지 검사합니다.
 * @param {string} uid
 */
function assertSafeUid(uid) {
  const s = String(uid || "").trim();
  if (!s) {
    throw new ApiError({
      errorCode: "INVALID_UID",
      message: "uid가 필요합니다.",
      httpStatusCode: 400,
      returnToUser: true
    });
  }
  if (/[.#$\[\]/]/.test(s)) {
    throw new ApiError({
      errorCode: "INVALID_UID",
      message: "INVALID UID",
      httpStatusCode: 400,
      returnToUser: true
    });
  }
  return s;
}

/**
 * RTDB `User/{uid}`에 사용자 노드를 생성·갱신합니다(멀티 경로 `update`, 클라이언트 `update(ref, updates)`와 동일 패턴).
 */
const createUser = _onRequest({
  opts: {
    memory: "256MiB",
    maxInstances: 2,
    concurrency: 10
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      user: {
        type: PropertyType.OBJECT,
        properties: {
          uid: { type: PropertyType.STRING, minLength: 1 },
          email: { type: PropertyType.STRING },
          photoURL: { type: PropertyType.STRING },
          displayName: { type: PropertyType.STRING },
          locale: { type: PropertyType.STRING },
          tenantId: { type: PropertyType.STRING, minLength: 1 },
          invitationId: { type: PropertyType.STRING },
          role: { type: PropertyType.STRING }
        },
        required: ["uid", "email", "locale"],
        additionalProperties: false
      }
    },
    required: ["user"],
    additionalProperties: false
  },
  handler: async (req) => {
    const u = req.body.user;
    const uid = assertSafeUid(u.uid);

    if (req.auth?.uid !== uid) {
      throw new ApiError({
        errorCode: "FORBIDDEN",
        message: "Authenticated user does not match request uid.",
        httpStatusCode: 403,
        returnToUser: true
      });
    }

    const str = (v, fallback = "") =>
      v != null && typeof v === "string" ? v : fallback;

    const ts = Date.now();
    const tenantId = str(u.tenantId, "").trim();
    const invitationId = str(u.invitationId, "").trim();
    const tenantIds = tenantId ? [tenantId] : [];
    const role = str(u.role, "").trim();
    const photoURL = await persistGoogleProfilePhotoIfNeeded(
      uid,
      str(u.photoURL, ""),
      { tenant_id: tenantId || "system" }
    );

    const updates = {
      [`${RTDB_USER_ROOT}/${uid}/uid`]: uid,
      [`${RTDB_USER_ROOT}/${uid}/email`]: str(u.email, ""),
      [`${RTDB_USER_ROOT}/${uid}/displayName`]: str(u.displayName, ""),
      [`${RTDB_USER_ROOT}/${uid}/photoURL`]: photoURL,
      [`${RTDB_USER_ROOT}/${uid}/status`]: str(u.status, "Active"),
      [`${RTDB_USER_ROOT}/${uid}/timeStamp`]: ts,
      [`${RTDB_USER_ROOT}/${uid}/createdAt`]: ts,
      [`${RTDB_USER_ROOT}/${uid}/tenantIds`]: tenantIds
    };

    try {
      await db.ref().update(updates);
    } catch (err) {
      logAndCaptureError(
        err instanceof Error ? err : new Error(String(err)),
        "[createUser] RTDB user create failed",
        {
          tenant_id: tenantId || "system",
          function_name: "createUser",
          extra: { uid }
        }
      );
      throw new ApiError({
        errorCode: "RTDB_USER_CREATE_FAILED",
        message: getLocalizedErrorMessage(
          str(u.locale, "en"),
          "RTDB_USER_CREATE_FAILED"
        ),
        httpStatusCode: 500,
        returnToUser: true
      });
    }

    if (tenantId && invitationId) {
      const tenantRef = store.collection(Collection.TENANTS).doc(tenantId);
      const memberRef = tenantRef.collection(Collection.MEMBERS).doc(uid);

      try {
          const invRef = tenantRef.collection(Collection.INVITATION).doc(invitationId);
          await store.runTransaction(async (t) => {
            const invSnap = await t.get(invRef);
            const memSnap = await t.get(memberRef);
            if (!invSnap.exists) {
              throw new ApiError({
                errorCode: "INVITATION_NOT_FOUND",
                message: "초대를 찾을 수 없습니다.",
                httpStatusCode: 404,
                returnToUser: true
              });
            }
            const inv = invSnap.data() || {};
            const invEmail =
              typeof inv.email === "string" ? inv.email.trim().toLowerCase() : "";
            const authEmail = String(req.auth?.email || "").trim().toLowerCase();
            const invitationStatus = String(inv.status || "").trim().toLowerCase();
            if (!invEmail || invEmail !== authEmail) {
              throw new ApiError({
                errorCode: "INVITATION_EMAIL_MISMATCH",
                message: "초대된 이메일과 계정 이메일이 일치하지 않습니다.",
                httpStatusCode: 403,
                returnToUser: true
              });
            }
            if (invitationStatus !== "waiting") {
              throw new ApiError({
                errorCode: "INVITATION_ALREADY_USED",
                message: "이미 사용되었거나 사용할 수 없는 초대입니다.",
                httpStatusCode: 409,
                returnToUser: true
              });
            }
            const memberPayload = {
              id: uid,
              uid,
              tenant_id: tenantId,
              role: inv.role || role || "member",
              displayName: str(u.displayName, ""),
              userPhotoURL: photoURL,
              email: str(u.email, ""),
              status: 'Active',
              updated_at: ts
            };
            const memberWrite = { ...memberPayload };
            if (!memSnap.exists) {
              memberWrite.created_at = ts;
            }
            t.set(memberRef, memberWrite, { merge: true });
            t.set(
              invRef,
              {
                status: "Deleted",
                updated_at: ts
              },
              { merge: true }
            );
          });
      } catch (err) {
        logAndCaptureError(err, "[createUser] member & invitation set failed", {
          tenant_id: tenantId || "system",
          extra: { uid, email: str(u.email, "") }
        });
      }
    }

    const email = str(u.email, "").trim();
    if (email) {
      try {
        await sendTemplateEmailFromBody({
          template_code: "welcome",
          to: email,
          locale: u.locale || "en",
          displayName: str(u.displayName, "")
        });
      } catch (err) {
        logAndCaptureError(err, "[createUser] welcome email failed", {
          tenant_id: tenantId || "system",
          extra: { uid, email }
        });
      }
    }

    return { status: "ok" };
  }
});

module.exports = createUser;