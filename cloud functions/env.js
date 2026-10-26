/**
 * Firebase Emulator 혹은 run serve로 로컬에서 실행한 Firebase Functions는 .env 파일이 자동으로 로드되지 않습니다.
 * 따라서 로컬 환경의 테스트를 위해서 강제로 env 파일들을 읽어 로딩하는 코드를 추가합니다.
 */
//for local environment
// PROFILE이 값이 정의되어있지 있지 않으면 local로 간주합니다.
const { logger } = require("firebase-functions/v2");
// process는 Node.js 전역 객체로 import 없이 사용 가능
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
  //ANTHROPIC (Claude)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  //GEMINI
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_API_VERSION: process.env.GEMINI_API_VERSION || "v1beta", // cachedContents API 버전 (기본값: v1beta, v1으로 변경 가능)
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
  // 선택: 설정 시 Cloud Run Job 중계 대신 ingestWorker를 직접 호출
  INGEST_FUNCTION_URL: process.env.INGEST_FUNCTION_URL,
  /** ARS mapping worker Cloud Function URL (Cloud Tasks target) */
  ARS_MAPPING_FUNCTION_URL: process.env.ARS_MAPPING_FUNCTION_URL,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  CLOUD_TASKS_SERVICE_ACCOUNT: process.env.CLOUD_TASKS_SERVICE_ACCOUNT,
  //SENTRY (선택)
  SENTRY_DSN: process.env.SENTRY_DSN,
  // Statuspage.io (선택, 설정 시 5분 주기 헬스 체크 후 컴포넌트 상태 전송)
  STATUSPAGE_PAGE_ID: process.env.STATUSPAGE_PAGE_ID,
  STATUSPAGE_API_KEY: process.env.STATUSPAGE_API_KEY,
  STATUSPAGE_CHAT_API_COMPONENT_ID: process.env.STATUSPAGE_CHAT_API_COMPONENT_ID,
  STATUSPAGE_DATASET_API_COMPONENT_ID: process.env.STATUSPAGE_DATASET_API_COMPONENT_ID,
  STATUSPAGE_CORE_API_COMPONENT_ID: process.env.STATUSPAGE_CORE_API_COMPONENT_ID,
  STATUSPAGE_PAYMENT_API_COMPONENT_ID: process.env.STATUSPAGE_PAYMENT_API_COMPONENT_ID,
  // Ephemeral JWT (api.frontierbase.io /session 발급, /chat 검증용). 32바이트 이상 강력한 랜덤값 권장.
  EPHEMERAL_JWT_SECRET: process.env.EPHEMERAL_JWT_SECRET,
  EPHEMERAL_TTL_SEC: Number(process.env.EPHEMERAL_TTL_SEC || "300"), // 5분

  // Billing (Lemon Squeezy): API Key, Store ID, Webhook signing secret
  LEMON_SQUEEZY_API_KEY: process.env.LEMON_SQUEEZY_API_KEY,
  LEMON_SQUEEZY_STORE_ID: process.env.LEMON_SQUEEZY_STORE_ID,
  LEMON_SQUEEZY_WEBHOOK_SECRET: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,

  // 공통 이메일: Resend API (발신 주소 도메인은 Resend에서 검증 필요)
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_USER: process.env.EMAIL_USER || "service@frontierbase.io",
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || "FrontierBase Team",

  // Google OAuth (Sheets/Picker용 code → token 교환)
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
};

const checkEnv = () => {
  // 필수 환경변수만 체크 (선택적 필드는 제외)
  const optionalKeys = [
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
    // Claude는 PRO/ENTERPRISE 복잡 케이스에서만 사용 (미설정 시 해당 플로우에서만 실패)
    'ANTHROPIC_API_KEY'
  ];
  Object.entries(environment).forEach(([key, value]) => {
    if (optionalKeys.includes(key)) {
      return; // 선택적 필드는 체크 스킵
    }
    if (typeof value === "undefined") {
      throw new Error(`${key} is not defined`);
    }
  });
};

checkEnv();

module.exports = environment;