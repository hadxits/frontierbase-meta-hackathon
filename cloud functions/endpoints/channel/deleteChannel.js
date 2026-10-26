/**
 * ============================================================================
 * deleteChannel.js - 채널(tenant) soft-delete + 삭제 안내 메일
 * ============================================================================
 *
 * - status: deleted, deleted_at, updated_at (문서 물리 삭제 없음)
 * - 요청자는 tenants/{tenant}/members/{uid} 에서 role=admin 이고 Active 여야 함
 * - Qdrant / dataset cascade 삭제 없음
 * ============================================================================
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const { logInfo, logWarn, logAndCaptureError, shouldCaptureError } = require("@/utils/logger");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { loadAndValidateTenant } = require("@/utils/tenant");
const { loadTenantMember } = require("@/utils/tenantMembership");
const { sendTemplateEmail } = require("@/utils/sendEmailCommon");
const { TEMPLATE_CODES } = require("@/utils/emailTemplates");

const TENANT_STATUS_DELETED = "deleted";
const MEMBER_ROLE_ADMIN = "admin";
const RECOVERY_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const CHANNEL_RECOVERY_URL = "https://console.frontierbase.io/channel-recovery";

const LOCALE_TO_BCP47 = {
  en: "en-US",
  ko: "ko-KR",
  ja: "ja-JP",
  de: "de-DE",
  fr: "fr-FR",
  it: "it-IT",
  zh: "zh-TW",
  es: "es-ES"
};

function formatDateForLocale(tsMs, locale) {
  if (!Number.isFinite(tsMs)) return "";
  const lang = String(locale || "en")
    .trim()
    .toLowerCase()
    .split("-")[0];
  const bcp47 = LOCALE_TO_BCP47[lang] || LOCALE_TO_BCP47.en;
  try {
    return new Intl.DateTimeFormat(bcp47, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(tsMs));
  } catch {
    return new Date(tsMs).toISOString();
  }
}

function resolveMailLocale(bodyLocale, tenantLocale) {
  const fromBody = String(bodyLocale || "").trim();
  if (fromBody) return fromBody;
  return String(tenantLocale || "en").trim() || "en";
}

async function assertTenantAdminMember(tenantId, uid, locale) {
  if (!uid) {
    throw new ApiError({
      errorCode: "CHANNEL_DELETE_FORBIDDEN",
      message: getLocalizedErrorMessage(locale, "CHANNEL_DELETE_FORBIDDEN"),
      httpStatusCode: 403,
      returnToUser: true
    });
  }

  const member = await loadTenantMember(tenantId, uid);
  const memberData = member.data;
  const isAdmin =
    member.exists && member.role === MEMBER_ROLE_ADMIN && member.isActive;

  if (!isAdmin) {
    logWarn("[deleteChannel] Forbidden: not active admin member", {
      tenant_id: tenantId,
      function_name: "deleteChannel",
      extra: {
        uid,
        role: memberData?.role || null,
        status: memberData?.status || null,
        exists: member.exists
      }
    });
    throw new ApiError({
      errorCode: "CHANNEL_DELETE_FORBIDDEN",
      message: getLocalizedErrorMessage(locale, "CHANNEL_DELETE_FORBIDDEN"),
      httpStatusCode: 403,
      returnToUser: true
    });
  }

  return memberData;
}

const deleteChannel = _onRequest({
  opts: {
    memory: "512MiB",
    cpu: "gcf_gen1",
    timeoutSeconds: 60,
    maxInstances: 2,
    concurrency: 1
  },
  requireCredential: true,
  stream: false,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING }
    },
    required: ["tenant"]
  },
  handler: async (req) => {
    try {
      const tenant = String(req.body?.tenant || "").trim();
      const uid = req.auth?.uid || null;
      const authEmail = String(req.auth?.email || "").trim();

      logInfo("[deleteChannel] Request received", {
        tenant_id: tenant,
        function_name: "deleteChannel",
        extra: { uid }
      });

      const { tenantData, locale: tenantLocale } = await loadAndValidateTenant(
        tenant,
        {
          locale: String(req.body?.locale || "en").trim() || "en",
          functionName: "deleteChannel",
          requireQdrantUrl: false
        }
      );

      const mailLocale = resolveMailLocale(req.body?.locale, tenantLocale);

      const memberData = await assertTenantAdminMember(tenant, uid, mailLocale);

      if (tenantData?.status === TENANT_STATUS_DELETED) {
        logWarn("[deleteChannel] Channel already deleted", {
          tenant_id: tenant,
          function_name: "deleteChannel"
        });
        return {
          success: true,
          tenant,
          status: TENANT_STATUS_DELETED,
          message: getLocalizedErrorMessage(mailLocale, "CHANNEL_ALREADY_DELETED")
        };
      }

      const nowMs = Date.now();
      const tenantRef = store.collection(Collection.TENANTS).doc(tenant);
      await tenantRef.set(
        {
          status: TENANT_STATUS_DELETED,
          deleted_at: nowMs,
          updated_at: nowMs
        },
        { merge: true }
      );

      logInfo("[deleteChannel] Tenant marked deleted", {
        tenant_id: tenant,
        function_name: "deleteChannel",
        extra: { deleted_at: nowMs }
      });

      const toEmail = authEmail || String(memberData?.email || "").trim();
      if (toEmail) {
        const displayName =
          String(memberData?.displayName || "").trim() ||
          String(req.auth?.token?.name || "").trim() ||
          toEmail;
        const channelName =
          String(tenantData?.name || "").trim() ||
          String(tenantData?.slug || "").trim() ||
          tenant;
        try {
          const mailResult = await sendTemplateEmail({
            templateCode: TEMPLATE_CODES.CHANNEL_DELETION,
            to: toEmail,
            locale: mailLocale,
            variables: {
              displayName,
              channelName,
              removedAt: formatDateForLocale(nowMs, mailLocale),
              recoveryDeadline: formatDateForLocale(
                nowMs + RECOVERY_GRACE_MS,
                mailLocale
              ),
              channelsConsoleUrl: CHANNEL_RECOVERY_URL
            }
          });
          if (!mailResult?.success) {
            logWarn("[deleteChannel] Deletion email send failed", {
              tenant_id: tenant,
              function_name: "deleteChannel",
              extra: { to: toEmail, messageId: mailResult?.messageId }
            });
          }
        } catch (mailErr) {
          logWarn("[deleteChannel] Deletion email error", {
            tenant_id: tenant,
            function_name: "deleteChannel",
            extra: {
              to: toEmail,
              error: mailErr?.message || String(mailErr)
            }
          });
        }
      } else {
        logWarn("[deleteChannel] No recipient email for deletion notice", {
          tenant_id: tenant,
          function_name: "deleteChannel",
          extra: { uid }
        });
      }

      return {
        success: true,
        tenant,
        status: TENANT_STATUS_DELETED,
        deleted_at: nowMs,
        message: getLocalizedErrorMessage(mailLocale, "CHANNEL_DELETE_SUCCESS")
      };
    } catch (e) {
      if (shouldCaptureError(e)) {
        logAndCaptureError(
          e instanceof Error ? e : new Error(String(e)),
          "[deleteChannel] Error",
          {
            tenant_id: req?.body?.tenant || "unknown",
            function_name: "deleteChannel",
            extra: {
              errorCode: e instanceof ApiError ? e.errorCode : undefined
            }
          }
        );
      }
      throw e;
    }
  }
});

module.exports = deleteChannel;
