const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const ApiError = require("@/errors/apiError");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { loadTenantMember } = require("@/utils/tenantMembership");

const MEMBER_ROLE_ADMIN = "admin";

async function assertActiveTenantAdmin(tenantId, uid, locale) {
  if (!tenantId || !uid) {
    throw new ApiError({
      errorCode: "BILLING_FORBIDDEN",
      message: getLocalizedErrorMessage(locale, "BILLING_FORBIDDEN"),
      httpStatusCode: 403,
      returnToUser: true
    });
  }

  const member = await loadTenantMember(tenantId, uid);

  if (
    !member.exists ||
    member.role !== MEMBER_ROLE_ADMIN ||
    !member.isActive
  ) {
    throw new ApiError({
      errorCode: "BILLING_FORBIDDEN",
      message: getLocalizedErrorMessage(locale, "BILLING_FORBIDDEN"),
      httpStatusCode: 403,
      returnToUser: true
    });
  }
}

async function paymentFieldExists(tenantId, collection, field, value) {
  const snap = await store
    .collection(Collection.TENANTS)
    .doc(String(tenantId))
    .collection(collection)
    .where(field, "==", String(value))
    .limit(1)
    .get();
  return !snap.empty;
}

async function assertTenantOwnsPaymentReference({
  tenantId,
  field,
  value,
  locale,
  errorCode,
  messageKey
}) {
  const currentExists = await paymentFieldExists(
    tenantId,
    Collection.PAYMENTS,
    field,
    value
  );
  if (currentExists) return;

  const historyExists = await paymentFieldExists(
    tenantId,
    Collection.PAYMENTS_HISTORY,
    field,
    value
  );
  if (!historyExists) {
    throw new ApiError({
      errorCode,
      message: getLocalizedErrorMessage(locale, messageKey),
      httpStatusCode: 404,
      returnToUser: true
    });
  }
}

async function assertTenantOwnsSubscription(
  tenantId,
  subscriptionId,
  locale
) {
  await assertTenantOwnsPaymentReference({
    tenantId,
    field: "subscription_ref",
    value: subscriptionId,
    locale,
    errorCode: "SUBSCRIPTION_NOT_FOUND",
    messageKey: "BILLING_SUBSCRIPTION_NOT_FOUND"
  });
}

async function assertTenantOwnsInvoice(tenantId, invoiceId, locale) {
  await assertTenantOwnsPaymentReference({
    tenantId,
    field: "invoice_ref",
    value: invoiceId,
    locale,
    errorCode: "SUBSCRIPTION_INVOICE_NOT_FOUND",
    messageKey: "BILLING_INVOICE_NOT_FOUND"
  });
}

module.exports = {
  assertActiveTenantAdmin,
  assertTenantOwnsSubscription,
  assertTenantOwnsInvoice
};
