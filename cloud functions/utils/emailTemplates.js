/**
 * ============================================================================
 * emailTemplates.js - 백엔드 이메일 (template_code + locale)
 * ============================================================================
 * - 마크업/문구는 emailTemplateBundles.js 에 변수로 둡니다.
 * - 새 메일: TEMPLATE_CODES + TEMPLATE_ID_BY_CODE + emailTemplateBundles.js 항목 추가.
 * ============================================================================
 */
const { detectLanguageFromLocale } = require("@/utils/localization");
const {
  loadBodyHtml,
  loadStrings,
  interpolate,
  markdownBoldToEmailStrong,
  newlineToEmailBr,
  stringsForLang,
} = require("@/utils/emailTemplateFiles");

/** 템플릿 코드 상수 (엔드포인트/트리거에서 이 코드로 호출) */
const TEMPLATE_CODES = {
  WELCOME: "welcome",
  DATASET_READY: "dataset_ready",
  /** 삭제·복구 안내(참고: GCP 프로젝트 삭제 경고형 레이아웃) */
  DATASET_DELETION: "dataset_deletion",
  /** 채널(tenant) 삭제·복구 안내 */
  CHANNEL_DELETION: "channel_deletion",
  CHANNEL_INVITE: "channel_invite",
  SUPPORT_CONFIRMATION: "support_confirmation",
  /** sendSupport → 내부 운영 알림 (HTTP API 미노출) */
  SUPPORT_ADMIN_NOTIFICATION: "support_admin_notification",
  BILLING_PAYMENT_REMINDER: "billing_payment_reminder",
  BILLING_CANCELLATION_REMINDER: "billing_cancellation_reminder",
  /** 토큰 잔량 50% / 10% 미만 (tokenLowNotifications) */
  TOKEN_LOW_REMINDER: "token_low_reminder",
  /** 일일 응답(대화) 요약 (responseSummaryNotifications) */
  RESPONSE_SUMMARY: "response_summary",
  /** 일일 미답변 요약 (unansweredSummaryNotifications) */
  UNANSWERED_SUMMARY: "unanswered_summary",
  /** sendPasswordResetEmail 전용 (sendTemplateEmail HTTP API에서는 제외) */
  PASSWORD_RESET: "password_reset",
  /** 이메일 OTP 로그인 (sendEmailLoginCode) */
  EMAIL_LOGIN_OTP: "email_login_otp",
  /** Issue Track — 요청자 확인 (HTTP sendTemplateEmail 미노출) */
  ISSUE_TRACK_USER_CONFIRMATION: "issue_track_user_confirmation",
  /** Issue Track — 테넌트 admin 알림 (HTTP 미노출) */
  ISSUE_TRACK_ADMIN_NOTIFICATION: "issue_track_admin_notification",
  /** Issue Track — 콘솔 회신 (HTTP 미노출) */
  ISSUE_TRACK_REPLY: "issue_track_reply",
};

const LANG_LIST = ["en", "ko", "ja", "de", "fr", "it", "zh", "es"];

/** template_code → templates/email 하위 폴더 이름 */
const TEMPLATE_ID_BY_CODE = {
  [TEMPLATE_CODES.WELCOME]: "welcome",
  [TEMPLATE_CODES.DATASET_READY]: "dataset_ready",
  [TEMPLATE_CODES.DATASET_DELETION]: "dataset_deletion",
  [TEMPLATE_CODES.CHANNEL_DELETION]: "channel_deletion",
  [TEMPLATE_CODES.CHANNEL_INVITE]: "channel_invite",
  [TEMPLATE_CODES.SUPPORT_CONFIRMATION]: "support_confirmation",
  [TEMPLATE_CODES.SUPPORT_ADMIN_NOTIFICATION]: "support_admin_notification",
  [TEMPLATE_CODES.BILLING_PAYMENT_REMINDER]: "billing_payment_reminder",
  [TEMPLATE_CODES.BILLING_CANCELLATION_REMINDER]: "billing_cancellation_reminder",
  [TEMPLATE_CODES.TOKEN_LOW_REMINDER]: "token_low_reminder",
  [TEMPLATE_CODES.RESPONSE_SUMMARY]: "response_summary",
  [TEMPLATE_CODES.UNANSWERED_SUMMARY]: "unanswered_summary",
  [TEMPLATE_CODES.PASSWORD_RESET]: "password_reset",
  [TEMPLATE_CODES.EMAIL_LOGIN_OTP]: "email_login_otp",
  [TEMPLATE_CODES.ISSUE_TRACK_USER_CONFIRMATION]: "issue_track_user_confirmation",
  [TEMPLATE_CODES.ISSUE_TRACK_ADMIN_NOTIFICATION]: "issue_track_admin_notification",
  [TEMPLATE_CODES.ISSUE_TRACK_REPLY]: "issue_track_reply",
};

function getLang(locale) {
  const lang = detectLanguageFromLocale(locale || "en");
  return LANG_LIST.includes(lang) ? lang : "en";
}

function escapeHtml(input) {
  const s = typeof input === "string" ? input : String(input ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(input) {
  return escapeHtml(input);
}

/** http(s) 초대·미리보기 URL만 허용 */
function safeHttpUrl(url) {
  const s = String(url || "").trim();
  if (!/^https?:\/\//i.test(s)) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return s;
  } catch {
    return "";
  }
}

const DEFAULT_CHANNEL_INVITE_CTA_BG = "#e85d04";

const WELCOME_CONSOLE_URL = "https://console.frontierbase.io/welcome";

/** dataset_deletion 등: `datasetsConsoleUrl` 미지정 시 콘솔 루트 */
const DEFAULT_DATASET_CONSOLE_URL = "https://console.frontierbase.io";
const DEFAULT_CHANNEL_RECOVERY_URL =
  "https://console.frontierbase.io/channel-recovery";

function buildConsoleDatasetsUrlWithLocale(locale, lang) {
  try {
    const u = new URL(DEFAULT_DATASET_CONSOLE_URL);
    const loc = String(locale || "").trim() || lang || "en";
    u.searchParams.set("locale", loc);
    return u.toString();
  } catch {
    return "";
  }
}

function buildConsoleChannelRecoveryUrlWithLocale(locale, lang) {
  try {
    const u = new URL(DEFAULT_CHANNEL_RECOVERY_URL);
    const loc = String(locale || "").trim() || lang || "en";
    u.searchParams.set("locale", loc);
    return u.toString();
  } catch {
    return "";
  }
}

function buildWelcomeConsoleUrlWithLocale(locale, lang) {
  const u = new URL(WELCOME_CONSOLE_URL);
  const loc = String(locale || "").trim() || lang || "en";
  u.searchParams.set("locale", loc);
  return u.toString();
}

const DEFAULT_CHANNEL_INVITE_SENDER_PHOTO_URL =
  "https://www.frontierbase.io/favicon-96x96.png";

function resolveChannelInviteSenderPhotoUrl(senderPhotoUrl) {
  const u = safeHttpUrl(senderPhotoUrl);
  return u || DEFAULT_CHANNEL_INVITE_SENDER_PHOTO_URL;
}

/** 초대 CTA 배경색: #RGB / #RRGGBB (선행 # 생략 가능), 그 외는 기본색 */
function sanitizeInviteCtaHexColor(raw) {
  let s = String(raw || "").trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(s)) return `#${s.toLowerCase()}`;
  return DEFAULT_CHANNEL_INVITE_CTA_BG;
}

function buildChannelInviteAvatarHtml(senderPhotoUrl) {
  const url = resolveChannelInviteSenderPhotoUrl(senderPhotoUrl);
  return `<div style="text-align:center"><img src="${escapeAttr(url)}" alt="" width="48" height="48" style="width:48px;height:48px;border-radius:50%;display:inline-block;object-fit:cover;border:1px solid #333333" /></div>`;
}

/** 채널 카드 왼쪽 썸네일: 유효한 senderPhotoUrl 또는 기본 파비콘 */
function buildChannelInviteCardThumbHtml(senderPhotoUrl) {
  const url = resolveChannelInviteSenderPhotoUrl(senderPhotoUrl);
  return `<img src="${escapeAttr(url)}" alt="" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:8px;object-fit:cover;border:0" />`;
}

function buildChannelInviteCtaHtml(inviteUrl, ctaLabel, ctaButtonColor) {
  const url = safeHttpUrl(inviteUrl);
  if (!url) return "";
  const bg = sanitizeInviteCtaHexColor(ctaButtonColor);
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0"><tr><td align="center" style="padding:0"><a href="${escapeAttr(url)}" style="display:inline-block;padding:14px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-align:center;text-decoration:none;background-color:${bg};border-radius:8px">${escapeHtml(ctaLabel)}</a></td></tr></table>`;
}

function buildWelcomeHtml(lang, variables = {}, locale = "") {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.WELCOME];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const displayNameRaw = variables.displayName || "";
  const displayName = escapeHtml(displayNameRaw);
  const hasDisplayName = displayName.trim().length > 0;
  const hey = hasDisplayName
    ? interpolate(t.hey_with_name, { displayName })
    : t.hey_default;
  const welcome = markdownBoldToEmailStrong(t.welcome);
  const body = newlineToEmailBr(t.body);
  const welcomeUrl = buildWelcomeConsoleUrlWithLocale(locale, lang);
  const ctaHtml = buildChannelInviteCtaHtml(
    welcomeUrl,
    t.cta_explore || "Explore features",
    DEFAULT_CHANNEL_INVITE_CTA_BG
  );
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    accent: "#e85d04",
    hey,
    welcome,
    body,
    ctaHtml,
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildDatasetReadyHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.DATASET_READY];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const displayNameRaw = variables.displayName || "";
  const datasetNameRaw = variables.datasetName || "Dataset";
  const displayName = escapeHtml(displayNameRaw);
  const datasetName = escapeHtml(datasetNameRaw);
  const hey = displayName
    ? interpolate(t.hey_with_name, { displayName })
    : t.hey_default;
  const body = newlineToEmailBr(interpolate(t.body, { datasetName }));
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    hey,
    body,
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildDatasetDeletionHtml(lang, variables = {}, locale = "") {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.DATASET_DELETION];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const displayNameRaw = variables.displayName || "";
  const displayName = escapeHtml(displayNameRaw);
  const datasetName = escapeHtml(
    String(variables.datasetName || "").trim() || "Dataset"
  );
  const removedAt = escapeHtml(String(variables.removedAt || "").trim());
  const recoveryDeadline = escapeHtml(
    String(variables.recoveryDeadline || "").trim()
  );

  const hey = displayNameRaw.trim()
    ? interpolate(t.hey_with_name, { displayName })
    : t.hey_default;

  const datasetLabel = interpolate(t.dataset_label, { datasetName });
  const warningTitle = escapeHtml(t.warning_title);

  const p1 = newlineToEmailBr(interpolate(t.p1, { datasetName, removedAt }));
  const p2 = newlineToEmailBr(
    markdownBoldToEmailStrong(interpolate(t.p2, { recoveryDeadline }))
  );
  const p3 = newlineToEmailBr(
    markdownBoldToEmailStrong(interpolate(t.p3, { recoveryDeadline }))
  );

  const customUrl = safeHttpUrl(String(variables.datasetsConsoleUrl || "").trim());
  const consoleUrl =
    customUrl || safeHttpUrl(buildConsoleDatasetsUrlWithLocale(locale, lang));
  const ctaHtml = buildChannelInviteCtaHtml(
    consoleUrl,
    t.cta_open_console,
    DEFAULT_CHANNEL_INVITE_CTA_BG
  );

  const formatStep = (s) =>
    newlineToEmailBr(markdownBoldToEmailStrong(String(s || "")));
  const stepItems = [t.step1, t.step2, t.step3]
    .map(
      (s) =>
        `<li style="margin:0 0 10px 0">${formatStep(s)}</li>`
    )
    .join("");
  const stepsHtml = `<ol style="margin:20px 0 0 0;padding-left:22px;text-align:left;color:#b0b0b0;font-size:15px;line-height:1.65">${stepItems}</ol>`;

  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    warningTitle,
    datasetLabel,
    hey,
    p1,
    p2,
    p3,
    stepsHtml,
    ctaHtml,
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildChannelDeletionHtml(lang, variables = {}, locale = "") {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.CHANNEL_DELETION];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const displayNameRaw = variables.displayName || "";
  const displayName = escapeHtml(displayNameRaw);
  const channelName = escapeHtml(
    String(variables.channelName || "").trim() || "Channel"
  );
  const removedAt = escapeHtml(String(variables.removedAt || "").trim());
  const recoveryDeadline = escapeHtml(
    String(variables.recoveryDeadline || "").trim()
  );

  const hey = displayNameRaw.trim()
    ? interpolate(t.hey_with_name, { displayName })
    : t.hey_default;

  const channelLabel = interpolate(t.channel_label, { channelName });
  const warningTitle = escapeHtml(t.warning_title);

  const p1 = newlineToEmailBr(interpolate(t.p1, { channelName, removedAt }));
  const p2 = newlineToEmailBr(
    markdownBoldToEmailStrong(interpolate(t.p2, { recoveryDeadline }))
  );
  const p3 = newlineToEmailBr(
    markdownBoldToEmailStrong(interpolate(t.p3, { recoveryDeadline }))
  );

  const customUrl = safeHttpUrl(
    String(variables.channelsConsoleUrl || "").trim()
  );
  const consoleUrl =
    customUrl ||
    safeHttpUrl(buildConsoleChannelRecoveryUrlWithLocale(locale, lang));
  const ctaHtml = buildChannelInviteCtaHtml(
    consoleUrl,
    t.cta_open_console,
    DEFAULT_CHANNEL_INVITE_CTA_BG
  );

  const formatStep = (s) =>
    newlineToEmailBr(markdownBoldToEmailStrong(String(s || "")));
  const stepItems = [t.step1, t.step2, t.step3]
    .map(
      (s) =>
        `<li style="margin:0 0 10px 0">${formatStep(s)}</li>`
    )
    .join("");
  const stepsHtml = `<ol style="margin:20px 0 0 0;padding-left:22px;text-align:left;color:#b0b0b0;font-size:15px;line-height:1.65">${stepItems}</ol>`;

  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    warningTitle,
    channelLabel,
    hey,
    p1,
    p2,
    p3,
    stepsHtml,
    ctaHtml,
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildBillingPaymentReminderHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.BILLING_PAYMENT_REMINDER];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const chargeDateLabel = escapeHtml(String(variables.chargeDateLabel || "").trim());
  const plan = escapeHtml(String(variables.plan || "").trim());
  const intro = newlineToEmailBr(t.intro);
  const footer_note = newlineToEmailBr(t.footer_note);
  const ctaHtml = buildChannelInviteCtaHtml(
    variables.billingConsoleUrl,
    t.cta_open_billing,
    DEFAULT_CHANNEL_INVITE_CTA_BG
  );
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    hey: t.hey_default,
    intro,
    label_date: escapeHtml(t.label_date),
    label_plan: escapeHtml(t.label_plan),
    chargeDateLabel,
    plan,
    ctaHtml,
    footer_note,
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildBillingCancellationReminderHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.BILLING_CANCELLATION_REMINDER];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const effectiveDateLabel = escapeHtml(
    String(variables.effectiveDateLabel || "").trim()
  );
  const intro = newlineToEmailBr(t.intro);
  const withdraw_note = newlineToEmailBr(t.withdraw_note);
  const footer_note = newlineToEmailBr(t.footer_note);
  const ctaHtml = buildChannelInviteCtaHtml(
    variables.billingConsoleUrl,
    t.cta_open_billing,
    DEFAULT_CHANNEL_INVITE_CTA_BG
  );
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    hey: t.hey_default,
    intro,
    label_date: escapeHtml(t.label_date),
    effectiveDateLabel,
    withdraw_note,
    ctaHtml,
    footer_note,
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildTokenLowReminderHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.TOKEN_LOW_REMINDER];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const remainingPercentLabel = escapeHtml(
    String(variables.remainingPercentLabel || "").trim()
  );
  const thresholdPercentLabel = escapeHtml(
    String(variables.thresholdPercentLabel || "").trim()
  );
  const plan = escapeHtml(String(variables.plan || "").trim());
  const intro = newlineToEmailBr(
    interpolate(t.intro, { remainingPercentLabel, thresholdPercentLabel })
  );
  const footer_note = newlineToEmailBr(t.footer_note);
  const ctaHtml = buildChannelInviteCtaHtml(
    variables.billingConsoleUrl,
    t.cta_open_billing,
    DEFAULT_CHANNEL_INVITE_CTA_BG
  );
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    hey: t.hey_default,
    intro,
    label_remaining: escapeHtml(t.label_remaining),
    label_plan: escapeHtml(t.label_plan),
    remainingPercentLabel,
    plan,
    ctaHtml,
    footer_note,
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildResponseSummaryHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.RESPONSE_SUMMARY];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const dateLabel = escapeHtml(String(variables.dateLabel || "").trim());
  const messageTotalLabel = escapeHtml(
    String(variables.messageTotalLabel || "").trim()
  );
  const moreTypesLabel = String(variables.moreTypesLabel || "").trim();
  const moreTypesNote = moreTypesLabel
    ? escapeHtml(interpolate(t.more_types, { moreTypesLabel }))
    : "";
  const questionTypesHtml =
    typeof variables.questionTypesHtml === "string"
      ? variables.questionTypesHtml
      : "";
  const ctaHtml = buildChannelInviteCtaHtml(
    variables.analyticsConsoleUrl || DEFAULT_DATASET_CONSOLE_URL,
    t.cta_open_analytics,
    DEFAULT_CHANNEL_INVITE_CTA_BG
  );
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    hey: t.hey_default,
    intro: newlineToEmailBr(t.intro),
    label_date: escapeHtml(t.label_date),
    label_messages: escapeHtml(t.label_messages),
    label_question_types: escapeHtml(t.label_question_types),
    dateLabel,
    messageTotalLabel,
    questionTypesHtml,
    moreTypesNote,
    ctaHtml,
    footer_note: newlineToEmailBr(t.footer_note),
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildUnansweredSummaryHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.UNANSWERED_SUMMARY];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const dateLabel = escapeHtml(String(variables.dateLabel || "").trim());
  const totalCountLabel = escapeHtml(
    String(variables.totalCountLabel || "").trim()
  );
  const moreCountLabel = String(variables.moreCountLabel || "").trim();
  const listedCountLabel = String(variables.listedCountLabel || "").trim();
  const moreCountNote = moreCountLabel
    ? escapeHtml(
        interpolate(t.more_count, { moreCountLabel, listedCountLabel })
      )
    : "";
  const itemsHtml =
    typeof variables.itemsHtml === "string" ? variables.itemsHtml : "";
  const ctaHtml = buildChannelInviteCtaHtml(
    variables.analyticsConsoleUrl || DEFAULT_DATASET_CONSOLE_URL,
    t.cta_open_analytics,
    DEFAULT_CHANNEL_INVITE_CTA_BG
  );
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    hey: t.hey_default,
    intro: newlineToEmailBr(t.intro),
    label_date: escapeHtml(t.label_date),
    label_total: escapeHtml(t.label_total),
    label_questions: escapeHtml(t.label_questions),
    dateLabel,
    totalCountLabel,
    itemsHtml,
    moreCountNote,
    ctaHtml,
    footer_note: newlineToEmailBr(t.footer_note),
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildSupportAdminNotificationHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.SUPPORT_ADMIN_NOTIFICATION];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    intro: newlineToEmailBr(t.intro),
    label_ticket: escapeHtml(t.label_ticket),
    label_from: escapeHtml(t.label_from),
    label_title: escapeHtml(t.label_title),
    label_contents: escapeHtml(t.label_contents),
    label_locale: escapeHtml(t.label_locale),
    label_screenshot: escapeHtml(t.label_screenshot),
    ticketNumber: escapeHtml(String(variables.ticketNumber || "").trim()),
    from: escapeHtml(String(variables.from || "").trim()),
    requestTitle: escapeHtml(String(variables.requestTitle || "").trim()),
    requestContentsHtml: escapeHtml(String(variables.requestContents || "").trim()),
    locale: escapeHtml(String(variables.locale || "").trim()),
    screenshotNote: escapeHtml(String(variables.screenshotNote || "").trim()),
    supportId: escapeHtml(String(variables.supportId || "").trim()),
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildSupportConfirmationHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.SUPPORT_CONFIRMATION];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const requestTitle = escapeHtml(String(variables.requestTitle || "").trim());
  const requestContentsHtml = escapeHtml(String(variables.requestContents || "").trim());
  const hey = t.hey_default;
  const intro = newlineToEmailBr(t.intro);
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    hey,
    intro,
    label_title: escapeHtml(t.label_title),
    label_contents: escapeHtml(t.label_contents),
    requestTitle,
    requestContentsHtml,
    footer_note: newlineToEmailBr(t.footer_note),
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildIssueTrackUserConfirmationHtml(lang, variables = {}) {
  const templateId =
    TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.ISSUE_TRACK_USER_CONFIRMATION];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    hey: escapeHtml(t.hey_default),
    intro: newlineToEmailBr(t.intro),
    label_issue: escapeHtml(t.label_issue),
    label_question: escapeHtml(t.label_question),
    issueNumber: escapeHtml(String(variables.issueNumber || "").trim()),
    questionHtml: escapeHtml(String(variables.question || "").trim()),
    footer_note: newlineToEmailBr(t.footer_note),
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildIssueTrackAdminNotificationHtml(lang, variables = {}) {
  const templateId =
    TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.ISSUE_TRACK_ADMIN_NOTIFICATION];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    intro: newlineToEmailBr(t.intro),
    label_issue: escapeHtml(t.label_issue),
    label_contact: escapeHtml(t.label_contact),
    label_tenant: escapeHtml(t.label_tenant),
    label_conversation: escapeHtml(t.label_conversation),
    label_question: escapeHtml(t.label_question),
    label_transcript: escapeHtml(t.label_transcript),
    issueNumber: escapeHtml(String(variables.issueNumber || "").trim()),
    contactEmail: escapeHtml(String(variables.contactEmail || "").trim()),
    tenantId: escapeHtml(String(variables.tenantId || "").trim()),
    conversationId: escapeHtml(String(variables.conversationId || "").trim()),
    questionHtml: escapeHtml(String(variables.question || "").trim()),
    transcriptHtml: escapeHtml(String(variables.transcript || "").trim()),
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildIssueTrackReplyHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.ISSUE_TRACK_REPLY];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    hey: escapeHtml(t.hey_default),
    label_issue: escapeHtml(t.label_issue),
    issueNumber: escapeHtml(String(variables.issueNumber || "").trim()),
    bodyHtml: escapeHtml(String(variables.body || "").trim()),
    year: String(new Date().getFullYear()),
  }).trim();
}

function resolveOtpPurposeLabel(stringsRow, purposeKey) {
  const key = String(purposeKey || "console")
    .trim()
    .toLowerCase();
  if (key === "admin") {
    return stringsRow.label_admin || stringsRow.label_console || "FrontierBase";
  }
  return stringsRow.label_console || "FrontierBase";
}

function buildEmailLoginOtpHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.EMAIL_LOGIN_OTP];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const label = escapeHtml(String(variables.label || "FrontierBase"));
  const code = escapeHtml(String(variables.code || "").trim());
  const ttlMin = escapeHtml(String(variables.ttlMin ?? ""));
  const intro = interpolate(t.intro, { label });
  const disclaimer = interpolate(t.disclaimer, { ttlMin });
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    intro,
    code,
    disclaimer,
    year: String(new Date().getFullYear()),
  }).trim();
}

/**
 * 이메일 OTP 로그인 메일 (locale 미지정 시 en)
 * @param {{ locale?: string, code: string, purposeKey?: string, ttlMin: number }} params
 * @returns {{ subject: string, html: string }}
 */
function getEmailLoginOtpMail({ locale, code, purposeKey, ttlMin }) {
  const lang = getLang(locale);
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.EMAIL_LOGIN_OTP];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const labelRaw = resolveOtpPurposeLabel(t, purposeKey);
  const subject = interpolate(t.subject, { label: labelRaw });
  const html = buildEmailLoginOtpHtml(lang, {
    label: labelRaw,
    code,
    ttlMin: String(ttlMin),
  });
  return { subject, html };
}

function buildPasswordResetHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.PASSWORD_RESET];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const emailRaw = String(variables.email || "").trim();
  const email = escapeHtml(emailRaw);
  const hey = t.hey_default;
  const body = newlineToEmailBr(
    markdownBoldToEmailStrong(interpolate(t.body, { email }))
  );
  const disclaimer = newlineToEmailBr(t.disclaimer);
  const thanks = newlineToEmailBr(t.thanks);
  const ctaHtml = buildChannelInviteCtaHtml(
    variables.resetUrl,
    t.cta_reset,
    DEFAULT_CHANNEL_INVITE_CTA_BG
  );
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    hey,
    body,
    ctaHtml,
    disclaimer,
    thanks,
    year: String(new Date().getFullYear()),
  }).trim();
}

function buildChannelInviteHtml(lang, variables = {}) {
  const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.CHANNEL_INVITE];
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  const senderRaw = (variables.sender || "").trim();
  const sender = senderRaw ? escapeHtml(senderRaw) : escapeHtml(t.default_sender);
  const channelNameRaw = (variables.channelName || "").trim();
  const channelName = escapeHtml(channelNameRaw || "Channel");
  const title = newlineToEmailBr(
    interpolate(t.title || t.subject, { sender, channelName })
  );
  const line1 = interpolate(t.body_line1, { channelName });
  const line2 = t.body_line2;
  const avatarHtml = buildChannelInviteAvatarHtml(variables.senderPhotoUrl);
  const channelCardThumbHtml = buildChannelInviteCardThumbHtml(variables.senderPhotoUrl);
  const ctaHtml = buildChannelInviteCtaHtml(variables.inviteUrl, t.cta, variables.ctaButtonColor);
  const html = loadBodyHtml(templateId);
  return interpolate(html, {
    avatarHtml,
    channelCardThumbHtml,
    title,
    line1,
    line2,
    channelName,
    cardSubtitle: t.card_subtitle,
    ctaHtml,
    footerTagline: newlineToEmailBr(t.footer_tagline),
    footerLinksHtml: t.footer_links_html,
    year: String(new Date().getFullYear()),
  }).trim();
}

function getSubjectForTemplate(templateCode, lang) {
  const templateId = TEMPLATE_ID_BY_CODE[templateCode];
  if (!templateId) return "FrontierBase";
  const bundle = loadStrings(templateId);
  const t = stringsForLang(bundle, lang);
  return t.subject || "FrontierBase";
}

/**
 * 템플릿 코드로 제목 반환
 * @param {string} locale - 예: "en", "ko-KR"
 * @param {string} templateCode - TEMPLATE_CODES 값
 * @param {Object} [variables] - channel_invite: sender, channelName
 * @returns {string}
 */
function getSubject(locale, templateCode, variables = {}) {
  const lang = getLang(locale);
  if (templateCode === TEMPLATE_CODES.CHANNEL_INVITE) {
    const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.CHANNEL_INVITE];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    const senderRaw = (variables.sender || "").trim();
    const sender = senderRaw ? escapeHtml(senderRaw) : escapeHtml(t.default_sender);
    const channelName = escapeHtml((variables.channelName || "").trim() || "Channel");
    return interpolate(t.subject, { sender, channelName });
  }
  if (templateCode === TEMPLATE_CODES.DATASET_DELETION) {
    const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.DATASET_DELETION];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    const datasetName = escapeHtml(
      String(variables.datasetName || "").trim() || "Dataset"
    );
    return interpolate(t.subject, { datasetName });
  }
  if (templateCode === TEMPLATE_CODES.CHANNEL_DELETION) {
    const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.CHANNEL_DELETION];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    const channelName = escapeHtml(
      String(variables.channelName || "").trim() || "Channel"
    );
    return interpolate(t.subject, { channelName });
  }
  if (templateCode === TEMPLATE_CODES.SUPPORT_CONFIRMATION) {
    const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.SUPPORT_CONFIRMATION];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    const ticketNumber = String(variables.ticketNumber || "").trim();
    return interpolate(t.subject, { ticketNumber });
  }
  if (templateCode === TEMPLATE_CODES.SUPPORT_ADMIN_NOTIFICATION) {
    const templateId =
      TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.SUPPORT_ADMIN_NOTIFICATION];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    return interpolate(t.subject, {
      ticketNumber: String(variables.ticketNumber || "").trim(),
      from: String(variables.from || "").trim(),
    });
  }
  if (templateCode === TEMPLATE_CODES.BILLING_PAYMENT_REMINDER) {
    const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.BILLING_PAYMENT_REMINDER];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    return interpolate(t.subject, {
      chargeDateLabel: String(variables.chargeDateLabel || "").trim(),
    });
  }
  if (templateCode === TEMPLATE_CODES.BILLING_CANCELLATION_REMINDER) {
    const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.BILLING_CANCELLATION_REMINDER];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    return interpolate(t.subject, {
      effectiveDateLabel: String(variables.effectiveDateLabel || "").trim(),
    });
  }
  if (templateCode === TEMPLATE_CODES.TOKEN_LOW_REMINDER) {
    const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.TOKEN_LOW_REMINDER];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    return interpolate(t.subject, {
      remainingPercentLabel: String(variables.remainingPercentLabel || "").trim(),
      thresholdPercentLabel: String(variables.thresholdPercentLabel || "").trim(),
    });
  }
  if (templateCode === TEMPLATE_CODES.RESPONSE_SUMMARY) {
    const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.RESPONSE_SUMMARY];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    return interpolate(t.subject, {
      dateLabel: String(variables.dateLabel || "").trim(),
    });
  }
  if (templateCode === TEMPLATE_CODES.UNANSWERED_SUMMARY) {
    const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.UNANSWERED_SUMMARY];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    return interpolate(t.subject, {
      dateLabel: String(variables.dateLabel || "").trim(),
      totalCountLabel: String(variables.totalCountLabel || "").trim(),
    });
  }
  if (templateCode === TEMPLATE_CODES.ISSUE_TRACK_USER_CONFIRMATION) {
    const templateId =
      TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.ISSUE_TRACK_USER_CONFIRMATION];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    return interpolate(t.subject, {
      issueNumber: String(variables.issueNumber || "").trim(),
    });
  }
  if (templateCode === TEMPLATE_CODES.ISSUE_TRACK_ADMIN_NOTIFICATION) {
    const templateId =
      TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.ISSUE_TRACK_ADMIN_NOTIFICATION];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    return interpolate(t.subject, {
      issueNumber: String(variables.issueNumber || "").trim(),
      contactEmail: String(variables.contactEmail || "").trim(),
    });
  }
  if (templateCode === TEMPLATE_CODES.ISSUE_TRACK_REPLY) {
    const templateId = TEMPLATE_ID_BY_CODE[TEMPLATE_CODES.ISSUE_TRACK_REPLY];
    const bundle = loadStrings(templateId);
    const t = stringsForLang(bundle, lang);
    return interpolate(t.subject, {
      issueNumber: String(variables.issueNumber || "").trim(),
      replySubject:
        String(variables.replySubject || "").trim() ||
        String(t.default_reply_subject || "").trim() ||
        "Update",
    });
  }
  return getSubjectForTemplate(templateCode, lang);
}

/**
 * 템플릿 코드로 HTML 본문 반환
 * @param {string} locale
 * @param {string} templateCode
 * @param {Object} variables
 * @returns {string}
 */
function getHtml(locale, templateCode, variables = {}) {
  const lang = getLang(locale);
  switch (templateCode) {
    case TEMPLATE_CODES.WELCOME:
      return buildWelcomeHtml(lang, variables, locale);
    case TEMPLATE_CODES.DATASET_READY:
      return buildDatasetReadyHtml(lang, variables);
    case TEMPLATE_CODES.DATASET_DELETION:
      return buildDatasetDeletionHtml(lang, variables, locale);
    case TEMPLATE_CODES.CHANNEL_DELETION:
      return buildChannelDeletionHtml(lang, variables, locale);
    case TEMPLATE_CODES.CHANNEL_INVITE:
      return buildChannelInviteHtml(lang, variables);
    case TEMPLATE_CODES.SUPPORT_CONFIRMATION:
      return buildSupportConfirmationHtml(lang, variables);
    case TEMPLATE_CODES.SUPPORT_ADMIN_NOTIFICATION:
      return buildSupportAdminNotificationHtml(lang, variables);
    case TEMPLATE_CODES.BILLING_PAYMENT_REMINDER:
      return buildBillingPaymentReminderHtml(lang, variables);
    case TEMPLATE_CODES.BILLING_CANCELLATION_REMINDER:
      return buildBillingCancellationReminderHtml(lang, variables);
    case TEMPLATE_CODES.TOKEN_LOW_REMINDER:
      return buildTokenLowReminderHtml(lang, variables);
    case TEMPLATE_CODES.RESPONSE_SUMMARY:
      return buildResponseSummaryHtml(lang, variables);
    case TEMPLATE_CODES.UNANSWERED_SUMMARY:
      return buildUnansweredSummaryHtml(lang, variables);
    case TEMPLATE_CODES.PASSWORD_RESET:
      return buildPasswordResetHtml(lang, variables);
    case TEMPLATE_CODES.EMAIL_LOGIN_OTP:
      return buildEmailLoginOtpHtml(lang, variables);
    case TEMPLATE_CODES.ISSUE_TRACK_USER_CONFIRMATION:
      return buildIssueTrackUserConfirmationHtml(lang, variables);
    case TEMPLATE_CODES.ISSUE_TRACK_ADMIN_NOTIFICATION:
      return buildIssueTrackAdminNotificationHtml(lang, variables);
    case TEMPLATE_CODES.ISSUE_TRACK_REPLY:
      return buildIssueTrackReplyHtml(lang, variables);
    default:
      return buildWelcomeHtml(lang, variables, locale);
  }
}

module.exports = {
  TEMPLATE_CODES,
  getSubject,
  getHtml,
  getLang,
  getEmailLoginOtpMail
};