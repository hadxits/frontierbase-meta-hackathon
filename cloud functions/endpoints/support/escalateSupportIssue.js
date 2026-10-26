/**
 * escalateSupportIssue — widget Issue Track create
 * Re-checks tenants/{tid}/plugin/default.issue_track_enabled (gateway never calls this).
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { logInfo, logWarn } = require("@/utils/logger");
const { generateIssueTrackNumber } = require("@/utils/supportTicket");
const { sendIssueCreatedEmails } = require("@/utils/supportIssueMailing");
const {
  isIssueTrackEnabled,
  loadPluginDefault,
  isValidContactEmail,
  loadConversationTranscript,
} = require("@/utils/issueTrack");
const {
  dispatchIssueTrackIntegrations,
} = require("@/utils/issueTrackIntegrations");
const {
  detectLanguageFromLocale,
  getLocalizedErrorMessage,
} = require("@/utils/localization");

const SUPPORTED_LOCALES = ["en", "ko", "ja", "de", "fr", "it", "zh", "es"];
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_CONVERSATION = 5;

/** @type {Map<string, number[]>} */
const escalateRateMap = new Map();

function resolveLocale(raw) {
  const lang = detectLanguageFromLocale(String(raw || "").trim() || "en");
  return SUPPORTED_LOCALES.includes(lang) ? lang : "en";
}

function assertRateLimit(tenantId, conversationId, locale) {
  const key = `${tenantId}:${conversationId}`;
  const now = Date.now();
  const prev = (escalateRateMap.get(key) || []).filter(
    (t) => now - t < RATE_WINDOW_MS
  );
  if (prev.length >= RATE_MAX_PER_CONVERSATION) {
    throw new ApiError({
      errorCode: "RATE_LIMITED",
      message: getLocalizedErrorMessage(locale, "ISSUE_TRACK_RATE_LIMITED"),
      httpStatusCode: 429,
      returnToUser: true,
    });
  }
  prev.push(now);
  escalateRateMap.set(key, prev);
}

module.exports = _onRequest({
  opts: {
    memory: "512MiB",
    timeoutSeconds: 120,
    maxInstances: 2,
    concurrency: 2,
    // embed 위젯: 임의 고객 Origin에서 브라우저 fetch 허용 (streamChatRag와 동일)
    cors: true,
  },
  requireCredential: false,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant_id: { type: PropertyType.STRING },
      conversation_id: { type: PropertyType.STRING },
      email: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING },
      question: { type: PropertyType.STRING },
    },
    required: ["tenant_id", "conversation_id"],
    additionalProperties: true,
  },
  handler: async (request) => {
    const body = request.body || {};
    const tenant_id = String(body.tenant_id || "").trim();
    const conversation_id = String(body.conversation_id || "").trim();
    const locale = resolveLocale(body.locale);
    const questionOverride =
      typeof body.question === "string" ? body.question.trim() : "";

    if (!tenant_id || !conversation_id) {
      throw new ApiError({
        errorCode: "INVALID_REQUEST",
        message: getLocalizedErrorMessage(locale, "ISSUE_TRACK_INVALID_REQUEST"),
        httpStatusCode: 400,
        returnToUser: true,
      });
    }

    if (String(request.headers?.["x-internal-gateway"] || "") === "1") {
      throw new ApiError({
        errorCode: "FORBIDDEN",
        message: getLocalizedErrorMessage(
          locale,
          "ISSUE_TRACK_GATEWAY_FORBIDDEN"
        ),
        httpStatusCode: 403,
        returnToUser: true,
      });
    }

    const { data: pluginData } = await loadPluginDefault(tenant_id);
    if (!isIssueTrackEnabled(pluginData)) {
      throw new ApiError({
        errorCode: "ISSUE_TRACK_DISABLED",
        message: getLocalizedErrorMessage(locale, "ISSUE_TRACK_DISABLED"),
        httpStatusCode: 403,
        returnToUser: true,
      });
    }

    assertRateLimit(tenant_id, conversation_id, locale);

    const chatRef = store
      .collection(Collection.TENANTS)
      .doc(tenant_id)
      .collection(Collection.CHATS)
      .doc(conversation_id);
    const chatSnap = await chatRef.get();
    const chat = chatSnap.exists ? chatSnap.data() || {} : {};

    const emailFromBody =
      typeof body.email === "string" ? body.email.trim() : "";
    const emailFromChat =
      typeof chat.email === "string" ? chat.email.trim() : "";
    const contactEmail = emailFromBody || emailFromChat;

    if (!isValidContactEmail(contactEmail)) {
      throw new ApiError({
        errorCode: "INVALID_EMAIL",
        message: getLocalizedErrorMessage(locale, "ISSUE_TRACK_INVALID_EMAIL"),
        httpStatusCode: 400,
        returnToUser: true,
      });
    }

    let question = questionOverride;
    if (!question) {
      const recent = await loadConversationTranscript(
        tenant_id,
        conversation_id,
        20
      );
      const lastUser = [...recent].reverse().find((m) => m.role === "user");
      question = lastUser?.content || "";
    }

    const now = Date.now();
    const issue_number = generateIssueTrackNumber();
    const issueRef = store
      .collection(Collection.TENANTS)
      .doc(tenant_id)
      .collection(Collection.SUPPORT_ISSUES)
      .doc();

    const issueDoc = {
      issue_number,
      conversation_id,
      contact_email: contactEmail,
      question: question || "",
      status: "open",
      source: "kb_miss",
      locale,
      created_at: now,
      updated_at: now,
      replies: [],
    };

    await issueRef.set(issueDoc);
    await chatRef.set(
      {
        email: contactEmail,
        updated_at: now,
        last_issue_number: issue_number,
        last_issue_id: issueRef.id,
      },
      { merge: true }
    );

    const mailResult = await sendIssueCreatedEmails({
      tenantId: tenant_id,
      conversationId: conversation_id,
      contactEmail,
      issueNumber: issue_number,
      question: question || "",
      locale,
    });

    if (mailResult.transcriptMessages?.length) {
      await issueRef.set(
        {
          transcript_snapshot: mailResult.transcriptMessages.slice(-40),
          updated_at: Date.now(),
        },
        { merge: true }
      );
    }

    logInfo("[escalateSupportIssue] Issue created", {
      tenant_id,
      conversation_id,
      function_name: "escalateSupportIssue",
      extra: {
        issue_id: issueRef.id,
        issue_number,
        user_email_sent: mailResult.userEmailSent,
        admin_email_sent: mailResult.adminEmailSent,
      },
    });

    if (!mailResult.adminEmailSent && !mailResult.adminSkipped) {
      logWarn("[escalateSupportIssue] Admin email failed", {
        tenant_id,
        function_name: "escalateSupportIssue",
        extra: { issue_number },
      });
    }

    let integrations = null;
    try {
      integrations = await dispatchIssueTrackIntegrations({
        tenantId: tenant_id,
        pluginData,
        issueId: issueRef.id,
        issueNumber: issue_number,
        conversationId: conversation_id,
        contactEmail,
        question: question || "",
        transcript: mailResult.transcript || "",
        locale,
      });
      const patch = { updated_at: Date.now() };
      if (integrations?.zendeskResult?.ok && integrations.zendeskResult.ticketId != null) {
        patch.zendesk_ticket_id = String(integrations.zendeskResult.ticketId);
      }
      if (integrations?.webhookResult?.ok) {
        patch.webhook_delivered = true;
      }
      if (Object.keys(patch).length > 1) {
        await issueRef.set(patch, { merge: true });
      }
    } catch (integErr) {
      logWarn("[escalateSupportIssue] Integrations dispatch failed", {
        tenant_id,
        function_name: "escalateSupportIssue",
        extra: {
          issue_number,
          error: integErr?.message || String(integErr),
        },
      });
    }

    return {
      success: true,
      issue_id: issueRef.id,
      issue_number,
      contact_email: contactEmail,
      user_email_sent: mailResult.userEmailSent,
      admin_email_sent: mailResult.adminEmailSent,
      zendesk_ticket_id: integrations?.zendeskResult?.ticketId || null,
      webhook_delivered: !!integrations?.webhookResult?.ok,
    };
  },
});