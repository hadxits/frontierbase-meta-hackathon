const { auth } = require("@/firebase");
const ApiError = require("@/errors/apiError");

/**
 * Verify Authorization: Bearer <Firebase ID Token>
 * @param {import("firebase-functions/v2/https").Request} request
 */
async function authenticateCredential(request) {
  const raw =
    request.headers.authorization || request.headers.Authorization || "";
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ApiError({
      errorCode: "UNAUTHENTICATED",
      message: "Authentication required.",
      httpStatusCode: 401,
      returnToUser: true
    });
  }

  const match = raw.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    throw new ApiError({
      errorCode: "UNAUTHENTICATED",
      message: "Invalid Authorization header.",
      httpStatusCode: 401,
      returnToUser: true
    });
  }

  try {
    const decoded = await auth.verifyIdToken(match[1]);
    request.auth = {
      isAuthenticated: true,
      uid: decoded.uid,
      email: decoded.email || null,
      token: decoded
    };
  } catch {
    throw new ApiError({
      errorCode: "UNAUTHENTICATED",
      message: "Invalid or expired authentication token.",
      httpStatusCode: 401,
      returnToUser: true
    });
  }
}

module.exports = authenticateCredential;