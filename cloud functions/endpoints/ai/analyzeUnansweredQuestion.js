/**
 * analyzeUnansweredQuestion.js
 *
 * Analyze unanswered questions by analytics_unanswered doc id + locale,
 * Issue 10-minute signed URL for GCS evidence.json and pass it as OpenAI input_file.file_url.
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { logAndCaptureError } = require("@/utils/logger");
const { loadAndValidateTenant } = require("@/utils/tenant");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { analyzeUnansweredQuestionGuide } = require("@/utils/unansweredAnalyticsGuide");

module.exports = _onRequest({
  opts: {
    memory: "1GiB",
    timeoutSeconds: 300,
    maxInstances: 5,
    concurrency: 2
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      analytics_unanswered_id: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING }
    },
    required: ["tenant", "analytics_unanswered_id", "locale"]
  },
  handler: async (req) => {
    const { tenant, analytics_unanswered_id, locale } = req.body;
    const requestLocale = String(locale || "").trim() || "en";

    const { tenantData } = await loadAndValidateTenant(tenant, {
      locale: requestLocale,
      functionName: "analyzeUnansweredQuestion",
      requireQdrantUrl: false
    });

    try {
      const guide = await analyzeUnansweredQuestionGuide({
        tenantId: tenant,
        analyticsUnansweredId: analytics_unanswered_id,
        locale: requestLocale,
        tenantData
      });
      return { guide };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logAndCaptureError("[analyzeUnansweredQuestion] Analysis failed", error, {
        tenant_id: tenant,
        function_name: "analyzeUnansweredQuestion",
        extra: {
          analytics_unanswered_id,
          error_message: error?.message || String(error),
          error_status: error?.status ?? null
        }
      });
      throw new ApiError({
        errorCode: "ANALYSIS_FAILED",
        message: getLocalizedErrorMessage(requestLocale, "ANALYSIS_FAILED"),
        httpStatusCode: 502,
        returnToUser: true
      });
    }
  }
});