// Firebase Collections
const Collection = {
  // -----------------------------
  // Tenant Root
  // -----------------------------
  TENANTS: "tenants",
  TENANTS_HISTORY: "tenantsHistory",

  // -----------------------------
  // Tenant Sub-Collections
  // -----------------------------
  ADDON_PACKS: "addon_packs",

  CHATS: "chats",
  CHAT_MESSAGES: "messages",

  DATASETS: "datasets",
  DATASETS_HISTORY: "datasets_history",
  DATASET_VERSIONS: "versions",
  DATASET_ROWS: "rows",

  MEMBERS: "members",

  /** tenants/{tenantId}/invitation/{invitationId} */
  INVITATION: "invitation",

  PLUGIN: "plugin",

  // -----------------------------
  // Usage / Billing
  // -----------------------------
  MESSAGE_USAGE: "message_usage",
  PROMPTS: "prompts",
  TOKEN_USAGE: "token_usage",

  USAGE_DAILY: "usage_daily",
  USAGE_MONTHLY: "usage_monthly",
  USAGE_BILLING: "usage_billing",

  AUDIT_MONTHLY: "audit_monthly",
  RAG_OBSERVATIONS: "rag_observations",

  PAYMENTS: "payments",
  PAYMENTS_HISTORY: "payments_history",

  // -----------------------------
  // Engine Monitoring
  // -----------------------------
  ENGINE: "engine",

  // -----------------------------
  // Chat Analytics (tenants 하위)
  // -----------------------------
  ANALYTICS_QUESTION_TYPE_DAILY: "analytics_question_type_daily",
  ANALYTICS_ROW_HITS: "analytics_row_hits",
  ANALYTICS_CLUSTER_MASTER: "analytics_cluster_master",
  ANALYTICS_UNANSWERED: "analytics_unanswered",

  // -----------------------------
  // Support
  // -----------------------------
  SUPPORT: "support",
  /** tenants/{tenantId}/support_issues/{issueId} — widget Issue Track */
  SUPPORT_ISSUES: "support_issues",

  /** tenants/{tenantId}/ars_menus/{datasetId} — ARS menu draft/published */
  ARS_MENUS: "ars_menus",

  // -----------------------------
  // Security
  // -----------------------------
  CREDENTIAL_STUFFING_RATE_LIMITS: "credential_stuffing_rate_limits",
  PASSWORD_RESET_RATE_LIMITS: "password_reset_rate_limits",

  /**
   * Server API Secret (top-level lookup by keyId)
   * Doc: server_api_keys/{keyId}
   */
  SERVER_API_KEYS: "server_api_keys",

  /** 이메일 OTP 로그인 (purpose별 doc id: `{purpose}:{emailHash}`) */
  EMAIL_LOGIN_OTP: "email_login_otp",
  EMAIL_LOGIN_RATE_LIMITS: "email_login_rate_limits"
};

module.exports = Collection;