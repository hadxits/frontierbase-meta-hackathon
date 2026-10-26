require("module-alias/register");
const environment = require("@/env");
const { AppConfig } = require("@/const/AppConfig");
const { logger, setGlobalOptions } = require("firebase-functions/v2");

// preserveExternalChanges: Firebase v2는 공식 문서상 여기(전역)만 지원.
// HttpsOptions(onRequest opts)에는 preserveExternalChanges가 타입/문서에 없음.
// 콘솔 Direct VPC 등은 전 함수에 적용되지만, 다른 함수는 코드와 콘솔 설정이 겹치지 않으면 영향 적음.
setGlobalOptions({
  preserveExternalChanges: true,
  region: AppConfig.GCP_REGION,
});

const init = () => {
  logger.info("Current Profile: " + environment.PROFILE);
  if (!environment.ENCRYPTION_ENABLED) {
    logger.warn("ENCRYPTION_ENABLED is false. ONLY USE IN DEVELOPMENT MODE");
  }
  if (!environment.SECURITY_FILTER_ENABLED) {
    logger.warn(
      "SECURITY_FILTER_ENABLED is false. ONLY USE IN DEVELOPMENT MODE"
    );
  }
};

init();

//FCM
exports.updateUser = require("@/endpoints/user/update");
exports.createUser = require("@/endpoints/user/createUser");
exports.checkCredentialStuffingRateLimit = require("@/endpoints/user/checkCredentialStuffingRateLimit");
exports.sendPasswordResetEmail = require("@/endpoints/user/sendPasswordResetEmail");

// Email OTP login (purpose-based: admin, console, ...)
exports.sendEmailLoginCode = require("@/endpoints/auth/sendEmailLoginCode");
exports.verifyEmailLoginCode = require("@/endpoints/auth/verifyEmailLoginCode");
exports.unenrollAuthenticator = require("@/endpoints/auth/unenrollAuthenticator");
exports.getAuthenticatorStatus = require("@/endpoints/auth/getAuthenticatorStatus");

//Email
exports.sendTemplateEmail = require("@/endpoints/email/sendTemplateEmail");
exports.queryUserByEmail = require("@/endpoints/user/queryUserByEmail");
//Support
exports.sendSupport = require("@/endpoints/support/sendSupport");
exports.escalateSupportIssue = require("@/endpoints/support/escalateSupportIssue");
exports.replySupportIssue = require("@/endpoints/support/replySupportIssue");

// Google OAuth (code → token 교환, Sheets/Picker용)
exports.exchangeGoogleOAuthCode = require("@/endpoints/google/exchangeOAuthCode");

//History
exports.saveTenantHistory = require('@/event/saveTenantHistory');
exports.savePaymentsHistory = require('@/event/savePaymentsHistory');
exports.saveDatasetsHistory = require('@/event/saveDatasetsHistory');

// API Gateway (api.frontierbase.io 도메인 매핑용: /chat, /messages, /session 등 → 내부 핸들러만 사용, index 노출 없음)
exports.apiGateway = require("@/endpoints/gateway/apiGateway");

//AI
exports.streamChatRag = require("@/endpoints/ai/streamChatRag");
exports.uploadDataset = require("@/endpoints/ai/uploadDataset").uploadDataset;
exports.syncGoogleSheetsDataset = require("@/endpoints/ai/syncGoogleSheetsDataset");
exports.deleteDataset = require("@/endpoints/ai/deleteDataset");
exports.deleteChannel = require("@/endpoints/channel/deleteChannel");
exports.getSourceDownloadUrl = require("@/endpoints/ai/getSourceDownloadUrl");

// Developer (Server API Secret)
exports.createServerApiSecret = require("@/endpoints/developer/createServerApiSecret");
exports.listServerApiSecrets = require("@/endpoints/developer/listServerApiSecrets");
exports.revokeServerApiSecret = require("@/endpoints/developer/revokeServerApiSecret");
exports.analyzeUnansweredQuestion = require("@/endpoints/ai/analyzeUnansweredQuestion");
// workerTask는 Cloud Tasks에서 호출되는 Cloud Function
exports.workerTask = require("@/endpoints/ai/workerTask");
exports.ingestWorker = require("@/endpoints/ai/ingestWorker");

// ARS (additive; does not touch streamChatRag)
exports.generateArsMenu = require("@/endpoints/ai/generateArsMenu");
exports.arsMappingWorker = require("@/endpoints/ai/arsMappingWorker");
exports.publishArsMenu = require("@/endpoints/ai/publishArsMenu");
exports.getArsMenu = require("@/endpoints/ai/getArsMenu");
exports.getArsMenuTree = require("@/endpoints/ai/getArsMenuTree");
exports.updateArsLeafReview = require("@/endpoints/ai/updateArsLeafReview");
exports.synthesizeArsSpeech = require("@/endpoints/ai/synthesizeArsSpeech");

// Health (Uptime Check용)
exports.cloudRunHealthCheck = require("@/endpoints/health/cloudRunHealthCheck");
exports.runStatuspageHealthCheck = require("@/endpoints/health/runStatuspageHealthCheck");

// Scheduler: 10분 주기 Cloud Run warm-up (idle scale-down 완화)
// status page랑 중복이라 막음
// exports.wakeUpInstances = require("@/scheduler/wakeUpInstances");
// Scheduler: 1분 주기 Google Sheets 자동 동기화 (next_sync_at, 유료 tenant)
// 나중에 유료 사용자가 생기면 On시킬것 console.google.com에 꺼져 있음
exports.syncGoogleSheetsAutoSync = require("@/scheduler/syncGoogleSheetsAutoSync");
// Scheduler: 10분 주기 헬스 체크 + Statuspage.io 컴포넌트 상태 전송
exports.statuspageHealthCheck = require("@/scheduler/statuspageHealthCheck");
// Scheduler: 5분 주기 결제·구독 취소 D-1 알림 메일 (admin 멤버 복수 수신)
exports.billingReminderNotifications = require("@/scheduler/billingReminderNotifications");
// Scheduler: 5분 주기 토큰 잔량 10% 미만 알림 (빌링 윈도우당 1회)
exports.tokenLowNotifications = require("@/scheduler/tokenLowNotifications");
// Scheduler: 매일 09:00(KST)=UTC 00:00 실행, UTC 어제 응답(대화) 일일 요약 메일
exports.responseSummaryNotifications = require("@/scheduler/responseSummaryNotifications");
// Scheduler: 매일 09:00(KST)=UTC 00:00 실행, UTC 어제 미답변 일일 요약 메일
exports.unansweredSummaryNotifications = require("@/scheduler/unansweredSummaryNotifications");
// Scheduler: 10분 주기 FREE 플랜 만료 빌링 윈도우 리셋
exports.resetFreeBillingWindows = require("@/scheduler/resetFreeBillingWindows");

// Billing (Lemon Squeezy) — 각 함수는 별도 Cloud Function 으로 배포됨
// - lemonsqueezyWebhook: 결제/구독 웹훅 (서명 검증 후 tenant.plan·payments 등 반영)
// - lemonsqueezyRequest: 체크아웃 URL 생성 (최초 구독·토큰팩 등)
// - lemonsqueezyCancel: 구독 취소 예약 (PATCH cancelled:true, tenant.billing.subscription_cancellation_pending)
// - lemonsqueezyResumeSubscription: 구독 취소 철회 (PATCH cancelled:false, cancellation_pending 제거)
// - lemonsqueezyUpgradeSubscription: 즉시 업그레이드 (PATCH variant + invoice_immediately)
// - lemonsqueezyScheduleSubscriptionChange: 다운그레이드 등 다음 갱신 반영 예약 (PATCH + subscription_change_pending)
// - lemonsqueezyCancelScheduledSubscriptionChange: 위 플랜 변경 예약 철회 (variant 되돌림 + pending 제거)
// - lemonsqueezyGetSubscriptionLink: 활성 구독 후보로 Lemon 조회 후 포털 URL 반환
// - lemonsqueezyGenerateSubscriptionInvoice: 구독 인보이스 PDF URL 생성
exports.lemonsqueezyWebhook = require("@/endpoints/billing/lemonsqueezyWebhook");
exports.lemonsqueezyRequest = require("@/endpoints/billing/lemonsqueezyRequest");
exports.lemonsqueezyCancel = require("@/endpoints/billing/lemonsqueezyCancel");
exports.lemonsqueezyResumeSubscription = require("@/endpoints/billing/lemonsqueezyResumeSubscription");
exports.lemonsqueezyUpgradeSubscription = require("@/endpoints/billing/lemonsqueezyUpgradeSubscription");
exports.lemonsqueezyScheduleSubscriptionChange = require("@/endpoints/billing/lemonsqueezyScheduleSubscriptionChange");
exports.lemonsqueezyCancelScheduledSubscriptionChange = require("@/endpoints/billing/lemonsqueezyCancelScheduledSubscriptionChange");
exports.lemonsqueezyGetSubscriptionLink = require("@/endpoints/billing/lemonsqueezyGetSubscriptionLink");
exports.lemonsqueezyGenerateSubscriptionInvoice = require("@/endpoints/billing/lemonsqueezyGenerateSubscriptionInvoice");