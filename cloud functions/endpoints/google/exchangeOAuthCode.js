/**
 * ============================================================================
 * exchangeOAuthCode.js - Google OAuth 코드 → 토큰 교환 API (POST)
 * ============================================================================
 * 프론트가 Google OAuth 인증 후 받은 authorization code를
 * access_token + refresh_token으로 교환한다.
 * - access_token: 프론트에서 Google Picker·Sheets API 호출용
 * - refresh_token: 이후 "주기 동기화" 시 백엔드에서 사용
 * ============================================================================
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const environment = require("@/env");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const exchangeOAuthCode = _onRequest({
  opts: {
    memory: "256MiB",
    maxInstances: 10,
    cpu: "gcf_gen1"
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      code: { type: PropertyType.STRING },
      redirect_uri: { type: PropertyType.STRING },
    },
    required: ["code", "redirect_uri"],
    additionalProperties: false,
  },
  handler: async (request) => {
    const { code, redirect_uri } = request.body;
    const clientId = environment.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = environment.GOOGLE_OAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new ApiError({
        errorCode: "CONFIG_ERROR",
        message: "Google OAuth is not configured.",
        httpStatusCode: 503,
        returnToUser: true,
      });
    }

    const body = new URLSearchParams({
      code,
      redirect_uri,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      const message =
        data.error_description || data.error || "Token exchange failed.";
      throw new ApiError({
        errorCode: "GOOGLE_OAUTH_ERROR",
        message,
        httpStatusCode: response.status >= 400 && response.status < 500 ? 400 : 502,
        returnToUser: true,
      });
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      expires_in: data.expires_in ?? 3599,
    };
  },
});

module.exports = exchangeOAuthCode;