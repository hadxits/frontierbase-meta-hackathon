/**
 * Firebase Emulator or locally run Firebase Functions via run serve do not auto-load .env files.
 * Therefore, add code to forcibly read and load env files for local testing.
 */
//for local environment
// If PROFILE value is undefined, consider environment as local.
const { logger } = require("firebase-functions/v2");
// process is a Node.js global object usable without import.
if (!process.env.PROFILE) {
  logger.info("Local environment detected");
  require("dotenv").config({ path: ".env" });
  require("dotenv").config({ path: ".env.local" });
}

const environment = {
  PROFILE: process.env.PROFILE,
  ENCRYPTION_ENABLED: process.env.ENCRYPTION_ENABLED === "true",
  SECURITY_FILTER_ENABLED: process.env.SECURITY_FILTER_ENABLED === "true",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  //firebase
  DATABASE_URL: process.env.DATABASE_URL,
  //OPENAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  MODEL_API_KEY: process.env.MODEL_API_KEY,
  MUSE_ARS_MODEL: process.env.MUSE_ARS_MODEL || "muse-spark-1.3",
  //ANTHROPIC (Claude)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  //GEMINI
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_API_VERSION: process.env.GEMINI_API_VERSION || "v1beta", // cachedContents API version (default: v1beta, can switch to v1).
  //LOGGING
  ENABLE_INFO_LOGS: process.env.ENABLE_INFO_LOGS !== "false" &&
                    process.env.ENABLE_INFO_LOGS !== "off",
  MAX_CONCURRENT_GEMINI_REQUESTS: process.env.MAX_CONCURRENT_GEMINI_REQUESTS,
  //MODELS
  CHAT_MODEL: process.env.CHAT_MODEL,
  EMBED_MODEL: process.env.EMBED_MODEL,
  //QDRANT
  QDRANT_TIMEOUT_MS: process.env.QDRANT_TIMEOUT_MS,
  QDRANT_COLLECTION_BASE: process.env.QDRANT_COLLECTION_BASE,
  //CLOUD TASKS
  GCP_LOCATION: process.env.GCP_LOCATION || "us-central1",
  CLOUD_TASKS_QUEUE_NAME: process.env.CLOUD_TASKS_QUEUE_NAME,
  WORKER_FUNCTION_URL: process.env.WORKER_FUNCTION_URL,
  // Optional: call ingestWorker directly instead of relaying via Cloud Run Job.
  INGEST_FUNCTION_URL: process.env.INGEST_FUNCTION_URL,
  /** ARS mapping worker Cloud Function URL (Cloud Tasks target) */
  ARS_MAPPING_FUNCTION_URL: process.env.ARS_MAPPING_FUNCTION_URL,
  ARS_MUSE_MAPPING_FUNCTION_URL: process.env.ARS_MUSE_MAPPING_FUNCTION_URL,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  CLOUD_TASKS_SERVICE_ACCOUNT: process.env.CLOUD_TASKS_SERVICE_ACCOUNT,
  //SENTRY (optional).
  SENTRY_DSN: process.env.SENTRY_DSN,
  // Statuspage.io (optional, sends component status after 5-minute health checks if configured).
  STATUSPAGE_PAGE_ID: process.env.STATUSPAGE_PAGE_ID,
  STATUSPAGE_API_KEY: process.env.STATUSPAGE_API_KEY,
  STATUSPAGE_CHAT_API_COMPONENT_ID: process.env.STATUSPAGE_CHAT_API_COMPONENT_ID,
  STATUSPAGE_DATASET_API_COMPONENT_ID: process.env.STATUSPAGE_DATASET_API_COMPONENT_ID,
  STATUSPAGE_CORE_API_COMPONENT_ID: process.env.STATUSPAGE_CORE_API_COMPONENT_ID,
  STATUSPAGE_PAYMENT_API_COMPONENT_ID: process.env.STATUSPAGE_PAYMENT_API_COMPONENT_ID,
  // Ephemeral JWT (issued by api.frontierbase.io /session, verified by /chat). Strong random value of 32 bytes or more recommended.
  EPHEMERAL_JWT_SECRET: process.env.EPHEMERAL_JWT_SECRET,
  EPHEMERAL_TTL_SEC: Number(process.env.EPHEMERAL_TTL_SEC || "300"), // 5 minutes

  // Billing (Lemon Squeezy): API Key, Store ID, Webhook signing secret
  LEMON_SQUEEZY_API_KEY: process.env.LEMON_SQUEEZY_API_KEY,
  LEMON_SQUEEZY_STORE_ID: process.env.LEMON_SQUEEZY_STORE_ID,
  LEMON_SQUEEZY_WEBHOOK_SECRET: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,

  // Common email: Resend API (sending address domain must be verified by Resend)
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_USER: process.env.EMAIL_USER || "service@frontierbase.io",
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || "FrontierBase Team",

  // Google OAuth (exchange code for token for Sheets/Picker)
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
};

const checkEnv = () => {
  // Check only required environment variables (exclude optional fields)
  const optionalKeys = [
    'MODEL_API_KEY',
    'MUSE_ARS_MODEL',
    'ARS_MUSE_MAPPING_FUNCTION_URL',
    'ENABLE_INFO_LOGS',
    'STATUSPAGE_PAGE_ID',
    'STATUSPAGE_API_KEY',
    'STATUSPAGE_CHAT_API_COMPONENT_ID',
    'STATUSPAGE_DATASET_API_COMPONENT_ID',
    'STATUSPAGE_CORE_API_COMPONENT_ID',
    'STATUSPAGE_PAYMENT_API_COMPONENT_ID',
    'EPHEMERAL_JWT_SECRET',
    'EPHEMERAL_TTL_SEC',
    'LEMON_SQUEEZY_API_KEY',
    'LEMON_SQUEEZY_STORE_ID',
    'LEMON_SQUEEZY_WEBHOOK_SECRET',
    'RESEND_API_KEY',
    'EMAIL_USER',
    'EMAIL_FROM_NAME',
    'INGEST_FUNCTION_URL',
    'ELEVENLABS_API_KEY',
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    // Claude is used only in PRO/ENTERPRISE complex cases (if not set, only that flow fails)
    'ANTHROPIC_API_KEY'
  ];
  Object.entries(environment).forEach(([key, value]) => {
    if (optionalKeys.includes(key)) {
      return; // Skip checking optional fields
    }
    if (typeof value === "undefined") {
      throw new Error(`${key} is not defined`);
    }
  });
};

checkEnv();

module.exports = environment;
