/**
 * Normalize variables objects to strings per template_code in sendTemplateEmail and similar.
 * Instead of listing fields in schema, add branching here to set default values for new template keys.
 * (Original text/HTML is in emailTemplateBundles.js).
 */
const { TEMPLATE_CODES } = require("@/utils/emailTemplates");

function toStr(v) {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : String(v);
}

/**
 * @param {string} templateCode
 * @param {unknown} raw - variables from request body (or compatible original).
 * @returns {Record<string, string>}
 */
function coerceTemplateVariables(templateCode, raw) {
  const input =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const base = Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, toStr(v)])
  );

  const defaults = defaultsForTemplate(templateCode);
  return { ...defaults, ...base };
}

function defaultsForTemplate(templateCode) {
  switch (templateCode) {
    case TEMPLATE_CODES.WELCOME:
      return { displayName: "" };
    case TEMPLATE_CODES.DATASET_READY:
      return { displayName: "", datasetName: "" };
    case TEMPLATE_CODES.DATASET_DELETION:
      return {
        displayName: "",
        datasetName: "",
        removedAt: "",
        recoveryDeadline: "",
        datasetsConsoleUrl: "",
      };
    case TEMPLATE_CODES.CHANNEL_DELETION:
      return {
        displayName: "",
        channelName: "",
        removedAt: "",
        recoveryDeadline: "",
        channelsConsoleUrl: "",
      };
    case TEMPLATE_CODES.CHANNEL_INVITE:
      return {
        sender: "",
        channelName: "",
        inviteUrl: "",
        senderPhotoUrl: "",
        ctaButtonColor: "",
      };
    case TEMPLATE_CODES.SUPPORT_CONFIRMATION:
      return {
        ticketNumber: "",
        requestTitle: "",
        requestContents: "",
      };
    case TEMPLATE_CODES.BILLING_PAYMENT_REMINDER:
      return {
        chargeDateLabel: "",
        plan: "",
        billingConsoleUrl: "",
        tenantName: "",
      };
    case TEMPLATE_CODES.BILLING_CANCELLATION_REMINDER:
      return {
        effectiveDateLabel: "",
        billingConsoleUrl: "",
        tenantName: "",
      };
    case TEMPLATE_CODES.TOKEN_LOW_REMINDER:
      return {
        remainingPercentLabel: "",
        thresholdPercentLabel: "",
        plan: "",
        tokenUsedLabel: "",
        tokenLimitLabel: "",
        billingConsoleUrl: "",
        tenantName: "",
      };
    case TEMPLATE_CODES.RESPONSE_SUMMARY:
      return {
        tenantName: "",
        dateLabel: "",
        messageTotalLabel: "",
        questionTypesHtml: "",
        moreTypesLabel: "",
        analyticsConsoleUrl: "",
      };
    case TEMPLATE_CODES.UNANSWERED_SUMMARY:
      return {
        tenantName: "",
        dateLabel: "",
        totalCountLabel: "",
        itemsHtml: "",
        moreCountLabel: "",
        listedCountLabel: "",
        analyticsConsoleUrl: "",
      };
    case TEMPLATE_CODES.PASSWORD_RESET:
      return { email: "", resetUrl: "" };
    default:
      return {};
  }
}

/** Field names allowed at request body root per template_code. */
const ROOT_VARIABLE_KEYS_BY_TEMPLATE = {
  [TEMPLATE_CODES.WELCOME]: ["displayName"],
  [TEMPLATE_CODES.DATASET_READY]: ["displayName", "datasetName"],
  [TEMPLATE_CODES.DATASET_DELETION]: [
    "displayName",
    "datasetName",
    "removedAt",
    "recoveryDeadline",
    "datasetsConsoleUrl",
  ],
  [TEMPLATE_CODES.CHANNEL_DELETION]: [
    "displayName",
    "channelName",
    "removedAt",
    "recoveryDeadline",
    "channelsConsoleUrl",
  ],
  [TEMPLATE_CODES.CHANNEL_INVITE]: [
    "sender",
    "channelName",
    "inviteUrl",
    "senderPhotoUrl",
    "ctaButtonColor",
  ],
  [TEMPLATE_CODES.SUPPORT_CONFIRMATION]: [
    "ticketNumber",
    "requestTitle",
    "requestContents",
  ],
  [TEMPLATE_CODES.BILLING_PAYMENT_REMINDER]: [
    "chargeDateLabel",
    "plan",
    "billingConsoleUrl",
    "tenantName",
  ],
  [TEMPLATE_CODES.BILLING_CANCELLATION_REMINDER]: [
    "effectiveDateLabel",
    "billingConsoleUrl",
    "tenantName",
  ],
  [TEMPLATE_CODES.TOKEN_LOW_REMINDER]: [
    "remainingPercentLabel",
    "thresholdPercentLabel",
    "plan",
    "tokenUsedLabel",
    "tokenLimitLabel",
    "billingConsoleUrl",
    "tenantName",
  ],
  [TEMPLATE_CODES.RESPONSE_SUMMARY]: [
    "tenantName",
    "dateLabel",
    "messageTotalLabel",
    "questionTypesHtml",
    "moreTypesLabel",
    "analyticsConsoleUrl",
  ],
  [TEMPLATE_CODES.UNANSWERED_SUMMARY]: [
    "tenantName",
    "dateLabel",
    "totalCountLabel",
    "itemsHtml",
    "moreCountLabel",
    "listedCountLabel",
    "analyticsConsoleUrl",
  ],
};

/**
 * Merge `variables` object with same-named fields at body root.
 * Allow client to work without `variables` by placing sender, channelName, etc. at root.
 * If a key exists in `variables` (including empty string), do not overwrite with root value.
 *
 * @param {string} templateCode
 * @param {unknown} body - request.body
 * @returns {Record<string, unknown>}
 */
function mergeVariablesFromRequestBody(templateCode, body) {
  const bodyObj = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const nested =
    bodyObj.variables != null &&
    typeof bodyObj.variables === "object" &&
    !Array.isArray(bodyObj.variables)
      ? { ...bodyObj.variables }
      : {};

  const keys = ROOT_VARIABLE_KEYS_BY_TEMPLATE[templateCode] || [];
  for (const k of keys) {
    if (!(k in nested) && bodyObj[k] !== undefined && bodyObj[k] !== null) {
      nested[k] = bodyObj[k];
    }
  }
  return nested;
}

module.exports = {
  coerceTemplateVariables,
  defaultsForTemplate,
  mergeVariablesFromRequestBody,
};