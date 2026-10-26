/**
 * Issue Track outbound integrations: Zendesk ticket + customer webhook.
 * Best-effort — failures are logged and must not block issue creation.
 */
const crypto = require("crypto");
const axios = require("axios");
const { logInfo, logWarn, logAndCaptureError } = require("@/utils/logger");
const { getIssueTrackCopy } = require("@/utils/localization");

function readIssueTrackConfig(pluginData) {
  const root = pluginData && typeof pluginData === "object" ? pluginData : {};
  const cfg = root.issue_track && typeof root.issue_track === "object" ? root.issue_track : {};
  const zendesk =
    cfg.zendesk && typeof cfg.zendesk === "object" ? cfg.zendesk : {};
  const webhook =
    cfg.webhook && typeof cfg.webhook === "object" ? cfg.webhook : {};
  return { zendesk, webhook };
}

function normalizeZendeskSubdomain(raw) {
  let s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "");
  s = s.replace(/\.zendesk\.com.*$/i, "");
  s = s.replace(/\/+$/, "");
  return s;
}

/**
 * @returns {Promise<{ ok: boolean, ticketId?: string|number, error?: string }>}
 */
async function createZendeskTicket({
  tenantId,
  zendesk,
  issueNumber,
  contactEmail,
  question,
  conversationId,
  transcript,
  locale,
}) {
  if (zendesk?.enabled !== true) return { ok: false, skipped: true };
  const subdomain = normalizeZendeskSubdomain(zendesk.subdomain);
  const email = String(zendesk.email || "").trim();
  const apiToken = String(zendesk.api_token || "").trim();
  if (!subdomain || !email || !apiToken) {
    return { ok: false, error: "Zendesk config incomplete" };
  }

  const copy = getIssueTrackCopy(locale);
  const subject = `[${copy.subjectPrefix} ${issueNumber}] ${String(question || "").slice(0, 120)}`;
  const body = [
    `FrontierBase ${copy.subjectPrefix}: ${issueNumber}`,
    `${copy.tenant}: ${tenantId}`,
    `${copy.conversation}: ${conversationId}`,
    `${copy.requester}: ${contactEmail}`,
    "",
    `${copy.question}:`,
    question || copy.none,
    "",
    `${copy.transcript}:`,
    transcript || copy.none,
  ].join("\n");

  const url = `https://${subdomain}.zendesk.com/api/v2/tickets.json`;
  const auth = Buffer.from(`${email}/token:${apiToken}`).toString("base64");

  try {
    const res = await axios.post(
      url,
      {
        ticket: {
          subject,
          comment: { body },
          requester: { email: contactEmail, name: contactEmail },
          tags: ["frontierbase", "issue_track"],
          external_id: issueNumber,
        },
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    if (res.status >= 200 && res.status < 300 && res.data?.ticket?.id != null) {
      logInfo("[issueTrackIntegrations] Zendesk ticket created", {
        tenant_id: tenantId,
        function_name: "createZendeskTicket",
        extra: { issue_number: issueNumber, ticket_id: res.data.ticket.id },
      });
      return { ok: true, ticketId: res.data.ticket.id };
    }
    const errMsg =
      res.data?.error ||
      res.data?.description ||
      `HTTP ${res.status}`;
    logWarn("[issueTrackIntegrations] Zendesk create failed", {
      tenant_id: tenantId,
      function_name: "createZendeskTicket",
      extra: { issue_number: issueNumber, status: res.status, errMsg },
    });
    return { ok: false, error: String(errMsg) };
  } catch (err) {
    logAndCaptureError(err, "[issueTrackIntegrations] Zendesk request error", {
      tenant_id: tenantId,
      function_name: "createZendeskTicket",
      extra: { issue_number: issueNumber },
    });
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * @returns {Promise<{ ok: boolean, error?: string, skipped?: boolean }>}
 */
async function postIssueWebhook({
  tenantId,
  webhook,
  payload,
}) {
  if (webhook?.enabled !== true) return { ok: false, skipped: true };
  const url = String(webhook.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "Webhook URL invalid" };
  }

  const bodyStr = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "FrontierBase-IssueTrack/1.0",
    "X-FrontierBase-Event": "issue_track.created",
  };
  const secret = String(webhook.secret || "").trim();
  if (secret) {
    const sig = crypto
      .createHmac("sha256", secret)
      .update(bodyStr)
      .digest("hex");
    headers["X-FrontierBase-Signature"] = `sha256=${sig}`;
  }

  try {
    const res = await axios.post(url, bodyStr, {
      headers,
      timeout: 12000,
      validateStatus: () => true,
      // body already stringified
      transformRequest: [(d) => d],
    });
    if (res.status >= 200 && res.status < 300) {
      logInfo("[issueTrackIntegrations] Webhook delivered", {
        tenant_id: tenantId,
        function_name: "postIssueWebhook",
        extra: { status: res.status },
      });
      return { ok: true };
    }
    logWarn("[issueTrackIntegrations] Webhook non-2xx", {
      tenant_id: tenantId,
      function_name: "postIssueWebhook",
      extra: { status: res.status },
    });
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    logAndCaptureError(err, "[issueTrackIntegrations] Webhook request error", {
      tenant_id: tenantId,
      function_name: "postIssueWebhook",
    });
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Run Zendesk + webhook after issue create (parallel, best-effort).
 */
async function dispatchIssueTrackIntegrations({
  tenantId,
  pluginData,
  issueId,
  issueNumber,
  conversationId,
  contactEmail,
  question,
  transcript,
  locale,
}) {
  const { zendesk, webhook } = readIssueTrackConfig(pluginData);
  const payload = {
    event: "issue_track.created",
    tenant_id: tenantId,
    issue_id: issueId,
    issue_number: issueNumber,
    conversation_id: conversationId,
    contact_email: contactEmail,
    question: question || "",
    transcript: transcript || "",
    locale: locale || "en",
    created_at: Date.now(),
  };

  const [zendeskResult, webhookResult] = await Promise.all([
    createZendeskTicket({
      tenantId,
      zendesk,
      issueNumber,
      contactEmail,
      question,
      conversationId,
      transcript,
      locale,
    }),
    postIssueWebhook({ tenantId, webhook, payload }),
  ]);

  return { zendeskResult, webhookResult };
}

module.exports = {
  readIssueTrackConfig,
  normalizeZendeskSubdomain,
  createZendeskTicket,
  postIssueWebhook,
  dispatchIssueTrackIntegrations,
};