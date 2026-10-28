/**
 * replySupportIssue — console send email to issue requester
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { FieldValue } = require("firebase-admin/firestore");
const { loadAndValidateTenant } = require("@/utils/tenant");
const { sendIssueTrackReplyEmail } = require("@/utils/supportIssueMailing");
const { isValidContactEmail } = require("@/utils/issueTrack");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logWarn } = require("@/utils/logger");

module.exports = _onRequest({
  opts: {
    memory: "256MiB",
    timeoutSeconds: 60,
    maxInstances: 4,
    concurrency: 5
  },
  requireCredential: true,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      issue_id: { type: PropertyType.STRING },
      subject: { type: PropertyType.STRING },
      body: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING }
    },
    required: ["tenant", "issue_id", "subject", "body"]
  },
  handler: async (req) => {
    const tenant = String(req.body.tenant || "").trim();
    const issue_id = String(req.body.issue_id || "").trim();
    const subject = String(req.body.subject || "").trim();
    const body = String(req.body.body || "").trim();
    const locale = String(req.body.locale || "").trim() || "en";

    if (!subject || !body) {
      throw new ApiError({
        errorCode: "INVALID_REQUEST",
        message: getLocalizedErrorMessage(locale, "ISSUE_TRACK_REPLY_REQUIRED"),
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    await loadAndValidateTenant(tenant, {
      locale,
      functionName: "replySupportIssue",
      requireQdrantUrl: false
    });

    const ref = store
      .collection(Collection.TENANTS)
      .doc(tenant)
      .collection(Collection.SUPPORT_ISSUES)
      .doc(issue_id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new ApiError({
        errorCode: "NOT_FOUND",
        message: getLocalizedErrorMessage(locale, "ISSUE_TRACK_NOT_FOUND"),
        httpStatusCode: 404,
        returnToUser: true
      });
    }

    const issue = snap.data() || {};
    const to = String(issue.contact_email || "").trim();
    if (!isValidContactEmail(to)) {
      throw new ApiError({
        errorCode: "INVALID_EMAIL",
        message: getLocalizedErrorMessage(
          locale,
          "ISSUE_TRACK_NO_CONTACT_EMAIL"
        ),
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const issueNumber = String(issue.issue_number || "").trim();
    const agentEmail = String(req.auth?.email || "").trim();
    if (!isValidContactEmail(agentEmail)) {
      // If sent without Reply-To, recipient replies go only to service@.
      logWarn("[replySupportIssue] No agent email for Reply-To", {
        tenant_id: tenant,
        function_name: "replySupportIssue",
        extra: { issue_id, uid: req.auth?.uid || null }
      });
    }
    const mailResult = await sendIssueTrackReplyEmail({
      to,
      locale: issue.locale || locale,
      issueNumber,
      replySubject: subject,
      body,
      tenantId: tenant,
      // Keep From as service@, set Reply-To so recipient replies go to the responsible person's email.
      ...(isValidContactEmail(agentEmail) ? { replyTo: agentEmail } : {})
    });

    if (!mailResult?.success) {
      throw new ApiError({
        errorCode: "EMAIL_FAILED",
        message: getLocalizedErrorMessage(
          locale,
          "ISSUE_TRACK_REPLY_SEND_FAILED"
        ),
        httpStatusCode: 502,
        returnToUser: true
      });
    }

    const now = Date.now();
    const replyEntry = {
      subject,
      body,
      to,
      created_at: now,
      by_uid: req.auth?.uid || null,
      by_email: req.auth?.email || null
    };

    await ref.set(
      {
        replies: FieldValue.arrayUnion(replyEntry),
        updated_at: now,
        status: issue.status === "open" ? "in_progress" : issue.status
      },
      { merge: true }
    );

    return {
      success: true,
      issue_id,
      issue_number: issueNumber,
      email_sent: true
    };
  }
});