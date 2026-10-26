/**
 * sendTemplateEmail 등에서 template_code별로 variables 객체를 문자열로 정규화합니다.
 * 스키마에 필드를 나열하지 않고, 여기 분기만 추가하면 새 템플릿 키 기본값을 맞출 수 있습니다.
 * (문구/HTML 원본은 emailTemplateBundles.js)
 */
const { TEMPLATE_CODES } = require("@/utils/emailTemplates");

function toStr(v) {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : String(v);
}

/**
 * @param {string} templateCode
 * @param {unknown} raw - request body의 variables (또는 호환용 원본)
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

/** template_code별로 요청 body 루트에 둘 수 있는 필드 이름 */
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
 * `variables` 객체와 body 최상위의 동일 이름 필드를 합칩니다.
 * 클라이언트가 `variables` 없이 sender·channelName 등을 루트에 두어도 동작하게 합니다.
 * `variables`에 키가 있으면(빈 문자열 포함) 루트 값으로 덮어쓰지 않습니다.
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