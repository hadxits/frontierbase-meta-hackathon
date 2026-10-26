// 애플리케이션 공통 설정 상수

/** Cloud Functions · Cloud Run Job · Cloud Tasks 큐 공통 GCP 리전 */
const GCP_REGION = "us-central1";

const AppConfig = {
  // 임베딩 모델
  DEFAULT_EMBED_MODEL: "text-embedding-3-small",

  /** OpenAI 경량 모델 (분류·변환·단순 채팅·요약) */
  DEFAULT_OPENAI_LITE_MODEL: "gpt-4.1-mini",

  /** OpenAI pre-stream 경량 (gpt-5.4-nano deprecated → gpt-5.6-luna) — transform/rerank/semantic 분류 */
  DEFAULT_OPENAI_PRESTREAM_MODEL: "gpt-5.6-luna",

  // GCP 프로젝트 ID
  GCP_PROJECT_ID: "frontierbase-console",

  GCP_REGION,

  // Cloud Run Job (ingest-worker-job)
  JOB_REGION: GCP_REGION,

  // Cloud Run Job 이름 (고정)
  // 동일한 Job을 사용하고, tenant/dataset 정보는 환경변수로 전달
  // Cloud Tasks Queue max-concurrent-dispatches 와 맞출 것 (동시 ingest-worker execution 상한)
  JOB_NAME: "ingest-worker-job",

  /** worker-queue 동시 dispatch 수 (= ingest-worker-job 동시 execution 목표) */
  WORKER_MAX_CONCURRENT_DISPATCHES: 5
};

module.exports = {
  AppConfig,
  GCP_REGION,
};