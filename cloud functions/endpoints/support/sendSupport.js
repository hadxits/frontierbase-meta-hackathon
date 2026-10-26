/**
 * ============================================================================
 * sendSupport.js - 지원 요청 제출 API
 * ============================================================================
 * - 클라이언트에서 from, title, contents 등 지원 요청 내용 전송.
 * - screenshot: URL 문자열 또는 base64 데이터 URI(data:image/...;base64,...).
 *   base64인 경우 Cloud Storage에 업로드 후 gs:// 경로만 Firestore에 저장(문서 1MB 제한 회피).
 * - Firestore "support" 컬렉션에 문서 추가.
 * - 티켓 번호 자동 생성 후 요청자(from)에게 확인 메일 발송 (locale 다국어).
 * - 내부 운영 알림 메일 발송 (david@hadfamily.com).
 * - API 호출 시 Sentry에 info 레벨로 노티.
 * ============================================================================
 */
const crypto = require("crypto");
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { store, storage } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { captureMessage } = require("@/utils/sentry");
const { logInfo, logWarn, logAndCaptureError } = require("@/utils/logger");
const { generateSupportTicketNumber } = require("@/utils/supportTicket");
const { TEMPLATE_CODES } = require("@/utils/emailTemplates");
const { sendTemplateEmail } = require("@/utils/sendEmailCommon");
const { detectLanguageFromLocale } = require("@/utils/localization");
const SUPPORT_STORAGE_PREFIX = "support";
const SUPPORT_ADMIN_NOTIFY_EMAIL = "david@hadfamily.com";

const SUPPORTED_LOCALES = ["en", "ko", "ja", "de", "fr", "it", "zh", "es"];

function resolveSupportLocale(raw) {
  const lang = detectLanguageFromLocale(String(raw || "").trim() || "en");
  return SUPPORTED_LOCALES.includes(lang) ? lang : "en";
}

/**
 * data:image/xxx;base64,... 형태 또는 순수 base64 문자열인지 판별.
 * @param {string} value
 * @returns {boolean}
 */
function isBase64Image(value) {
  if (typeof value !== "string" || !value.length) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith("data:image/") && trimmed.includes(";base64,"))
    return true;
  // 순수 base64만 오는 경우: 길이가 충분하고 URL이 아니면 base64로 간주
  return trimmed.length > 500 && !/^https?:\/\//i.test(trimmed);
}

/**
 * base64 이미지 디코딩. data URI면 payload만 추출 후 Buffer 반환.
 * @param {string} base64String
 * @returns {{ buffer: Buffer, extension: string }}
 */
function decodeBase64Image(base64String) {
  const trimmed = base64String.trim();
  let payload = trimmed;
  let extension = "png";
  if (trimmed.startsWith("data:image/")) {
    const match = trimmed.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) throw new Error("Invalid data URI for image");
    extension = match[1].toLowerCase().replace("jpeg", "jpg");
    payload = match[2];
  }
  const buffer = Buffer.from(payload, "base64");
  return { buffer, extension };
}

/**
 * base64 이미지를 Cloud Storage에 업로드하고 gs:// 경로 반환.
 * @param {Buffer} buffer
 * @param {string} extension
 * @returns {Promise<string>} gs://bucket/path
 */
async function uploadScreenshotToStorage(buffer, extension) {
  const bucketName = "frontierbase-console.firebasestorage.app";
  const bucket = storage.bucket(bucketName);
  const name = `${SUPPORT_STORAGE_PREFIX}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${extension}`;
  const file = bucket.file(name);
  await file.save(buffer, {
    metadata: {
      contentType: `image/${extension === "jpg" ? "jpeg" : extension}`
    }
  });
  return `gs://${bucketName}/${name}`;
}

/**
 * 요청자에게 티켓 확인 메일 발송 (실패해도 지원 요청 저장은 유지).
 */
async function sendSupportConfirmationEmail({
                                              to,
                                              locale,
                                              ticketNumber,
                                              requestTitle,
                                              requestContents
                                            }) {
  try {
    return await sendTemplateEmail({
      templateCode: TEMPLATE_CODES.SUPPORT_CONFIRMATION,
      to,
      locale,
      variables: {
        ticketNumber,
        requestTitle,
        requestContents
      }
    });
  } catch (err) {
    logAndCaptureError(err, "[sendSupport] Confirmation email failed", {
      tenant_id: "support",
      function_name: "sendSupport",
      extra: { to, ticketNumber, requestTitle }
    });
    return { success: false };
  }
}

/**
 * 내부 운영 알림 (실패해도 지원 요청 저장은 유지).
 */
async function sendSupportAdminNotificationEmail({
                                                   supportId,
                                                   ticketNumber,
                                                   from,
                                                   locale,
                                                   requestTitle,
                                                   requestContents,
                                                   screenshot,
                                                   screenshotRef
                                                 }) {
  const screenshotNote =
    screenshotRef || screenshot ? screenshotRef || screenshot : "(none)";
  try {
    return await sendTemplateEmail({
      templateCode: TEMPLATE_CODES.SUPPORT_ADMIN_NOTIFICATION,
      to: SUPPORT_ADMIN_NOTIFY_EMAIL,
      locale: "en",
      variables: {
        supportId,
        ticketNumber,
        from,
        locale,
        requestTitle,
        requestContents,
        screenshotNote
      }
    });
  } catch (err) {
    logAndCaptureError(err, "[sendSupport] Admin notification email failed", {
      tenant_id: "support",
      function_name: "sendSupport",
      extra: {
        to: SUPPORT_ADMIN_NOTIFY_EMAIL,
        supportId,
        ticketNumber,
        from,
        requestTitle
      }
    });
    return { success: false };
  }
}

const sendSupport = _onRequest({
  opts: {
    memory: "1GiB",
    cpu: "gcf_gen1",
    maxInstances: 3,
    concurrency: 1
  },
  params: {
    type: PropertyType.OBJECT,
    properties: {
      from: { type: PropertyType.STRING },
      title: { type: PropertyType.STRING },
      contents: { type: PropertyType.STRING },
      screenshot: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING }
    },
    required: ["from", "title", "contents"],
    additionalProperties: true
  },
  handler: async (request) => {
    const body = request.body || {};
    const from = String(body.from || "").trim();
    const title = String(body.title || "").trim();
    const contents = String(body.contents || "").trim();
    const locale = resolveSupportLocale(body.locale);
    const screenshotInput =
      typeof body.screenshot === "string" ? body.screenshot.trim() : "";
    const ticket_number = generateSupportTicketNumber();

    let screenshot = "";
    let screenshot_ref = "";

    if (screenshotInput) {
      if (isBase64Image(screenshotInput)) {
        try {
          const { buffer, extension } = decodeBase64Image(screenshotInput);
          screenshot_ref = await uploadScreenshotToStorage(buffer, extension);
        } catch (err) {
          if (err instanceof ApiError) throw err;
          logAndCaptureError(err, "[sendSupport] Screenshot upload failed", {
            tenant_id: "support",
            function_name: "sendSupport",
            extra: { from, title, ticket_number }
          });
          throw new ApiError({
            errorCode: "SCREENSHOT_UPLOAD_FAILED",
            message: "Screenshot could not be uploaded.",
            httpStatusCode: 502,
            returnToUser: true
          });
        }
      } else {
        screenshot = screenshotInput;
      }
    }

    const now = Date.now();
    const supportDoc = {
      from,
      title,
      contents,
      ticket_number,
      locale,
      created_at: now,
      ...(screenshot ? { screenshot } : {}),
      ...(screenshot_ref ? { screenshot_ref } : {})
    };

    try {
      const ref = await store.collection(Collection.SUPPORT).add(supportDoc);

      const [emailResult, adminEmailResult] = await Promise.all([
        sendSupportConfirmationEmail({
          to: from,
          locale,
          ticketNumber: ticket_number,
          requestTitle: title,
          requestContents: contents
        }),
        sendSupportAdminNotificationEmail({
          supportId: ref.id,
          ticketNumber: ticket_number,
          from,
          locale,
          requestTitle: title,
          requestContents: contents,
          screenshot,
          screenshotRef: screenshot_ref
        })
      ]);

      if (!emailResult?.success) {
        logWarn("[sendSupport] Support saved but confirmation email not sent", {
          tenant_id: "support",
          function_name: "sendSupport",
          extra: { support_id: ref.id, ticket_number, from }
        });
      } else {
        logInfo("[sendSupport] Confirmation email sent", {
          tenant_id: "support",
          function_name: "sendSupport",
          extra: {
            support_id: ref.id,
            ticket_number,
            from,
            messageId: emailResult.messageId
          }
        });
      }

      if (!adminEmailResult?.success) {
        logWarn(
          "[sendSupport] Support saved but admin notification email not sent",
          {
            tenant_id: "support",
            function_name: "sendSupport",
            extra: {
              support_id: ref.id,
              ticket_number,
              notify_to: SUPPORT_ADMIN_NOTIFY_EMAIL
            }
          }
        );
      } else {
        logInfo("[sendSupport] Admin notification email sent", {
          tenant_id: "support",
          function_name: "sendSupport",
          extra: {
            support_id: ref.id,
            ticket_number,
            notify_to: SUPPORT_ADMIN_NOTIFY_EMAIL,
            messageId: adminEmailResult.messageId
          }
        });
      }

      return {
        success: true,
        support_id: ref.id,
        ticket_number,
        email_sent: !!emailResult?.success,
        admin_email_sent: !!adminEmailResult?.success
      };
    } catch (err) {
      logAndCaptureError(err, "[sendSupport] Firestore add failed", {
        tenant_id: "support",
        function_name: "sendSupport",
        extra: { from, title, ticket_number }
      });
      throw new ApiError({
        errorCode: "SUPPORT_SUBMIT_FAILED",
        message: "Support request could not be saved.",
        httpStatusCode: 502,
        returnToUser: true
      });
    }
  }
});

module.exports = sendSupport;