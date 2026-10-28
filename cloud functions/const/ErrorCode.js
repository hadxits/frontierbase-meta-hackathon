/**
 * FrontierBase public API (api.frontierbase.io) error codes.
 * Use FB_ prefix so developer docs and clients handle codes consistently.
 *
 * Ranges by type:
 * - 1xx: Authentication (Auth)
 * - 2xx: Client/Request
 * - 3xx: Tenant/Account
 * - 5xx: Server
 */
const ErrorCode = {
  // ---------------------------------------------------------------------------
  // Auth (1xx) - Bearer token validation (used in ephemeralToken etc.)
  // ---------------------------------------------------------------------------
  /** Bearer token missing */
  MISSING_BEARER_TOKEN: "FB_100",
  /** Token expired */
  TOKEN_EXPIRED: "FB_101",
  /** Invalid token */
  INVALID_TOKEN: "FB_102",
  /** Insufficient scope/permission */
  INVALID_SCOPE: "FB_103",
  /** Server API Secret missing or invalid format */
  INVALID_SERVER_API_SECRET: "FB_104",
  /** JWT tenant and body plugin_key mismatch */
  TENANT_MISMATCH: "FB_105",

  // ---------------------------------------------------------------------------
  // Client / Request (2xx) - request parameter or state errors
  // ---------------------------------------------------------------------------
  /** Message is empty */
  EMPTY_MESSAGE: "FB_200",
  /** Message length exceeded */
  MESSAGE_TOO_LONG: "FB_201",

  // ---------------------------------------------------------------------------
  // Tenant / Account (3xx) - tenant or quota issues
  // ---------------------------------------------------------------------------
  /** Tenant inactive */
  TENANT_INACTIVE: "FB_300",
  /** Quota exceeded */
  QUOTA_EXCEEDED: "FB_301",
  /** FREE plan: session issuance not allowed (paid plan required) */
  FREE_PLAN_NOT_ALLOWED: "FB_302",

  // ---------------------------------------------------------------------------
  // Server (5xx) - internal server errors
  // ---------------------------------------------------------------------------
  /** Internal server error */
  INTERNAL_SERVER_ERROR: "FB_500",
  /** Initialization failed */
  INIT_FAILED: "FB_501",
};

module.exports = ErrorCode;