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

//Support
exports.sendSupport = require("@/endpoints/support/sendSupport");
exports.escalateSupportIssue = require("@/endpoints/support/escalateSupportIssue");
exports.replySupportIssue = require("@/endpoints/support/replySupportIssue");

// Google OAuth (exchange code for token, for Sheets/Picker)
exports.exchangeGoogleOAuthCode = require("@/endpoints/google/exchangeOAuthCode");

//History
exports.saveTenantHistory = require('@/event/saveTenantHistory');
exports.saveDatasetsHistory = require('@/event/saveDatasetsHistory');

//AI
exports.streamChatRag = require("@/endpoints/ai/streamChatRag");
exports.uploadDataset = require("@/endpoints/ai/uploadDataset").uploadDataset;
exports.syncGoogleSheetsDataset = require("@/endpoints/ai/syncGoogleSheetsDataset");
exports.deleteDataset = require("@/endpoints/ai/deleteDataset");
exports.deleteChannel = require("@/endpoints/channel/deleteChannel");
exports.getSourceDownloadUrl = require("@/endpoints/ai/getSourceDownloadUrl");

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

// Google Sheets synchronization uses the existing ingestion pipeline.
exports.syncGoogleSheetsAutoSync = require("@/scheduler/syncGoogleSheetsAutoSync");
