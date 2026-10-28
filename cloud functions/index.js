require("module-alias/register");
const environment = require("@/env");
const { AppConfig } = require("@/const/AppConfig");
const { logger, setGlobalOptions } = require("firebase-functions/v2");

// preserveExternalChanges: Firebase v2 officially supports this only here (global).
// HttpsOptions (onRequest opts) does not have preserveExternalChanges in its type or docs.
// Console Direct VPC applies to all functions, but other functions are less affected if code and console settings don't overlap.
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

// Google OAuth (exchange code for token, for Sheets/Picker)
exports.exchangeGoogleOAuthCode = require("@/endpoints/google/exchangeOAuthCode");

//History
exports.saveTenantHistory = require('@/event/saveTenantHistory');
exports.savePaymentsHistory = require('@/event/savePaymentsHistory');
exports.saveDatasetsHistory = require('@/event/saveDatasetsHistory');

// API Gateway (for api.frontierbase.io domain mapping: /chat, /messages, /session etc. → internal handlers only, no index exposure)
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
// workerTask is a Cloud Function called by Cloud Tasks
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
exports.generateArsMenuMuse = require("@/endpoints/ai/generateArsMenuMuse");
exports.arsMappingWorkerMuse = require("@/endpoints/ai/arsMappingWorkerMuse");
exports.getArsMenuTreeMuse = require("@/endpoints/ai/getArsMenuTreeMuse");

// Health (for Uptime Check)
exports.cloudRunHealthCheck = require("@/endpoints/health/cloudRunHealthCheck");
exports.runStatuspageHealthCheck = require("@/endpoints/health/runStatuspageHealthCheck");

// Scheduler: Cloud Run warm-up every 10 minutes (to reduce idle scale-down)
// Disabled because it duplicates the status page
// exports.wakeUpInstances = require("@/scheduler/wakeUpInstances");
// Scheduler: Google Sheets auto-sync every 1 minute (next_sync_at, paid tenants)
// Will enable later when paid users exist; currently disabled in console.google.com
exports.syncGoogleSheetsAutoSync = require("@/scheduler/syncGoogleSheetsAutoSync");
// Scheduler: health check every 10 minutes + send component status to Statuspage.io
exports.statuspageHealthCheck = require("@/scheduler/statuspageHealthCheck");
// Scheduler: payment/subscription cancellation D-1 reminder email every 5 minutes (multiple admin members receive)
exports.billingReminderNotifications = require("@/scheduler/billingReminderNotifications");
// Scheduler: token balance below 10% alert every 5 minutes (once per billing window)
exports.tokenLowNotifications = require("@/scheduler/tokenLowNotifications");
// Scheduler: runs daily at 09:00 KST (UTC 00:00), sends daily summary email of previous day's responses (conversations) in UTC
exports.responseSummaryNotifications = require("@/scheduler/responseSummaryNotifications");
// Scheduler: runs daily at 09:00 KST (UTC 00:00), sends daily summary email of previous day's unanswered items in UTC
exports.unansweredSummaryNotifications = require("@/scheduler/unansweredSummaryNotifications");
// Scheduler: resets FREE plan billing window every 10 minutes
exports.resetFreeBillingWindows = require("@/scheduler/resetFreeBillingWindows");

// Billing (Lemon Squeezy) — each function deployed as separate Cloud Function
// - lemonsqueezyWebhook: payment/subscription webhook (updates tenant.plan, payments etc. after signature verification)
// - lemonsqueezyRequest: creates checkout URL (initial subscription, token packs etc.)
// - lemonsqueezyCancel: schedules subscription cancellation (PATCH cancelled:true, tenant.billing.subscription_cancellation_pending)
// - lemonsqueezyResumeSubscription: cancels subscription cancellation (PATCH cancelled:false, removes cancellation_pending)
// - lemonsqueezyUpgradeSubscription: immediate upgrade (PATCH variant + invoice_immediately)
// - lemonsqueezyScheduleSubscriptionChange: schedules next renewal changes like downgrade (PATCH + subscription_change_pending)
// - lemonsqueezyCancelScheduledSubscriptionChange: cancels scheduled plan change (reverts variant + removes pending)
// - lemonsqueezyGetSubscriptionLink: queries Lemon for active subscription candidate and returns portal URL
// - lemonsqueezyGenerateSubscriptionInvoice: generates subscription invoice PDF URL
exports.lemonsqueezyWebhook = require("@/endpoints/billing/lemonsqueezyWebhook");
exports.lemonsqueezyRequest = require("@/endpoints/billing/lemonsqueezyRequest");
exports.lemonsqueezyCancel = require("@/endpoints/billing/lemonsqueezyCancel");
exports.lemonsqueezyResumeSubscription = require("@/endpoints/billing/lemonsqueezyResumeSubscription");
exports.lemonsqueezyUpgradeSubscription = require("@/endpoints/billing/lemonsqueezyUpgradeSubscription");
exports.lemonsqueezyScheduleSubscriptionChange = require("@/endpoints/billing/lemonsqueezyScheduleSubscriptionChange");
exports.lemonsqueezyCancelScheduledSubscriptionChange = require("@/endpoints/billing/lemonsqueezyCancelScheduledSubscriptionChange");
exports.lemonsqueezyGetSubscriptionLink = require("@/endpoints/billing/lemonsqueezyGetSubscriptionLink");
exports.lemonsqueezyGenerateSubscriptionInvoice = require("@/endpoints/billing/lemonsqueezyGenerateSubscriptionInvoice");
