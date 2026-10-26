/**
 * Issue Track mailing (admin full transcript / user short confirmation / console reply)
 */
const { TEMPLATE_CODES } = require("@/utils/emailTemplates");
const { sendTemplateEmail } = require("@/utils/sendEmailCommon");
const { resolveAdminEmails } = require("@/utils/billingReminders");
const { logAndCaptureError, logWarn } = require("@/utils/logger");
const {
  loadConversationTranscript,
  formatTranscriptPlain,
} = require("@/utils/issueTrack");

async function sendIssueTrackUserConfirmation({
  to,
  locale,
  issueNumber,
  question,
  tenantId,
}) {
  try {
    return await sendTemplateEmail({
      templateCode: TEMPLATE_CODES.ISSUE_TRACK_USER_CONFIRMATION,
      to,
      locale,
      variables: { issueNumber, question },
    });
  } catch (err) {
    logAndCaptureError(err, "[supportIssueMailing] User confirmation failed", {
      tenant_id: tenantId || "unknown",
      function_name: "sendIssueTrackUserConfirmation",
      extra: { to, issueNumber },
    });
    return { success: false };
  }
}

async function sendIssueTrackAdminNotification({
  tenantId,
  locale,
  issueNumber,
  contactEmail,
  conversationId,
  question,
  transcript,
}) {
  const adminEmails = await resolveAdminEmails(tenantId);
  if (!adminEmails.length) {
    logWarn("[supportIssueMailing] No active admin emails", {
      tenant_id: tenantId,
      function_name: "sendIssueTrackAdminNotification",
      extra: { issueNumber },
    });
    return { success: false, skipped: true, adminEmails: [] };
  }
  try {
    const result = await sendTemplateEmail({
      templateCode: TEMPLATE_CODES.ISSUE_TRACK_ADMIN_NOTIFICATION,
      to: adminEmails,
      locale: locale || "en",
      variables: {
        issueNumber,
        contactEmail,
        tenantId,
        conversationId,
        question,
        transcript,
      },
    });
    return { ...result, adminEmails };
  } catch (err) {
    logAndCaptureError(err, "[supportIssueMailing] Admin notification failed", {
      tenant_id: tenantId,
      function_name: "sendIssueTrackAdminNotification",
      extra: { issueNumber, contactEmail },
    });
    return { success: false, adminEmails };
  }
}

/**
 * Load transcript + send both issue-created emails.
 */
async function sendIssueCreatedEmails({
  tenantId,
  conversationId,
  contactEmail,
  issueNumber,
  question,
  locale,
}) {
  const messages = await loadConversationTranscript(
    tenantId,
    conversationId,
    40
  );
  const transcript = formatTranscriptPlain(messages, locale);
  const [userResult, adminResult] = await Promise.all([
    sendIssueTrackUserConfirmation({
      to: contactEmail,
      locale,
      issueNumber,
      question,
      tenantId,
    }),
    sendIssueTrackAdminNotification({
      tenantId,
      locale,
      issueNumber,
      contactEmail,
      conversationId,
      question,
      transcript,
    }),
  ]);
  return {
    userEmailSent: !!userResult?.success,
    adminEmailSent: !!adminResult?.success,
    adminSkipped: !!adminResult?.skipped,
    transcriptMessages: messages,
    transcript,
  };
}

async function sendIssueTrackReplyEmail({
  to,
  locale,
  issueNumber,
  replySubject,
  body,
  tenantId,
  /** 콘솔에서 회신한 담당자 이메일 — 수신자가 답장하면 이 주소로 Reply-To */
  replyTo,
}) {
  try {
    return await sendTemplateEmail({
      templateCode: TEMPLATE_CODES.ISSUE_TRACK_REPLY,
      to,
      locale,
      variables: { issueNumber, replySubject, body },
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (err) {
    logAndCaptureError(err, "[supportIssueMailing] Reply email failed", {
      tenant_id: tenantId || "unknown",
      function_name: "sendIssueTrackReplyEmail",
      extra: { to, issueNumber, replyTo: replyTo || null },
    });
    return { success: false };
  }
}

module.exports = {
  sendIssueTrackUserConfirmation,
  sendIssueTrackAdminNotification,
  sendIssueCreatedEmails,
  sendIssueTrackReplyEmail,
};