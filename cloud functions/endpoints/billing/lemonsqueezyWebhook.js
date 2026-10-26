/**
 * Lemon Squeezy webhook: signature verification, then dispatch by event.
 * Writes to tenants/{tenantId}/payments, addon_packs, and tenant.plan.
 *
 * Raw body is provided by the runtime as req.rawBody (Buffer) for X-Signature verification.
 */
const { onRequest } = require("firebase-functions/v2/https");
const { sentryWrapper, captureMessage } = require("@/utils/sentry");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const {
  verifyWebhookSignature,
  getTenantIdFromWebhook,
  lemonClient,
  getVariantInfo,
  parseIsoToMs,
  mapSubscriptionStatus,
} = require("@/utils/lemonsqueezy");
const { logInfo, logWarn, logAndCaptureError } = require("@/utils/logger");
const { getQuotaForPlan } = require("@/utils/planQuota");
const { disableGoogleSheetsAutoSyncForTenant } = require("@/utils/googleSheetsAutoSync");

const TOKEN_PACK_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

function parseFormattedMoneyToNumber(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  // Keep digits, comma, dot. Drop currency symbols and spaces.
  const cleaned = s.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  // Heuristic:
  // - If both comma and dot exist: assume comma is thousands separator (e.g. 2,500.00)
  // - Else if only comma exists: treat comma as decimal separator (e.g. 2500,00)
  // - Else: parse as-is (e.g. 2500.00)
  let normalized = cleaned;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) normalized = cleaned.replace(/,/g, "");
  else if (hasComma && !hasDot) normalized = cleaned.replace(/,/g, ".");

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lemon Squeezy money parsing (orders / subscription-invoices).
 * - attrs.total/subtotal are provided in minor units (e.g. cents) as integers in our webhook payload.
 * - Prefer integer minor units when present; fall back to formatted strings only when needed.
 */
function parseOrderAmount(attrs) {
  const totalMinor =
    typeof attrs?.total === "number"
      ? attrs.total
      : typeof attrs?.total_in_cents === "number"
        ? attrs.total_in_cents
        : typeof attrs?.subtotal === "number"
          ? attrs.subtotal
          : null;
  if (typeof totalMinor === "number" && Number.isFinite(totalMinor)) {
    const amountCents = Math.round(totalMinor);
    return { amountCents, amount: amountCents / 100, source: "minor_units" };
  }

  const formatted =
    attrs?.total_formatted ??
    attrs?.subtotal_formatted ??
    attrs?.tax_formatted ??
    null;
  const amount = parseFormattedMoneyToNumber(formatted);
  if (typeof amount === "number") {
    return { amountCents: Math.round(amount * 100), amount, source: "formatted" };
  }

  return { amountCents: null, amount: null, source: "none" };
}

function makeBillingCycleKey(subscriptionId, invoiceId) {
  if (!subscriptionId || !invoiceId) return "";
  return `${String(subscriptionId)}:${String(invoiceId)}`;
}

async function requireTenantDocOrCapture(tenantId, context = {}) {
  const tenantRef = store.collection(Collection.TENANTS).doc(String(tenantId));
  const snap = await tenantRef.get();
  if (snap.exists) return { tenantRef, tenantSnap: snap };

  captureMessage("LemonSqueezy webhook: tenant doc missing (skip writes)", "warning", {
    tenant_id: String(tenantId || "unknown"),
    function_name: "lemonsqueezyWebhook",
    extra: context,
  });
  return { tenantRef, tenantSnap: null };
}

/**
 * Write payment snapshot to tenants/{tenantId}/payments/{paymentId}
 */
async function upsertPaymentSnapshot(tenantId, payload) {
  const paymentId = payload.paymentId || `ls_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const ref = store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.PAYMENTS)
    .doc(paymentId);

  const data = {
    provider: "lemonsqueezy",
    kind: payload.kind || "subscription",
    plan: payload.plan || "FREE",
    status: payload.status || "active",
    current_period_start: payload.current_period_start ?? null,
    current_period_end: payload.current_period_end ?? null,
    customer_ref: payload.customer_ref || "",
    customer_email: payload.customer_email || "",
    subscription_ref: payload.subscription_ref || "",
    order_ref: payload.order_ref || "",
    variant_id: payload.variant_id ?? null,
    currency: payload.currency || "",
    amount: payload.amount ?? null,
    amount_cents: payload.amount_cents ?? null,
    invoice_ref: payload.invoice_ref || "",
    invoice_status: payload.invoice_status || "",
    billing_reason: payload.billing_reason || "",
    created_at: payload.created_at ?? null,
    tenant_id: tenantId,
    updated_at: Date.now(),
  };

  await ref.set(data, { merge: true });
  return paymentId;
}

const PLUGIN_DEFAULT_ID = "default";

/**
 * tenants.plan 변경 시 tenants/{tenantId}/plugin/default 문서의 plan, updated_at만 merge.
 * FREE 로 내려갈 때 Google Sheets dataset auto_sync_enabled 도 false 로 내립니다.
 */
async function syncPluginDefaultPlan(tenantId, plan, updatedAt) {
  const ref = store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.PLUGIN)
    .doc(PLUGIN_DEFAULT_ID);
  await ref.set({ plan, updated_at: updatedAt }, { merge: true });

  if (String(plan || "FREE").toUpperCase() !== "FREE") return;

  try {
    await disableGoogleSheetsAutoSyncForTenant(tenantId);
  } catch (err) {
    logAndCaptureError(
      err instanceof Error ? err : new Error(String(err)),
      "[lemonsqueezyWebhook] Failed to disable Google Sheets auto sync for FREE tenant",
      {
        tenant_id: tenantId,
        function_name: "lemonsqueezyWebhook"
      }
    );
  }
}

/**
 * Create addon_pack doc and append to tenant.addon_token for token pack orders.
 * Idempotent: fixed doc id + transaction.create prevents duplicates.
 * Also includes a recovery path: if pack exists but tenant.addon_token is missing, append once.
 */
async function applyTokenPackOrder(tenantId, orderPayload) {
  const attrs = orderPayload?.data?.attributes || {};
  const firstItem = attrs.first_order_item;
  const variantId = firstItem?.variant_id;
  const orderId = String(orderPayload?.data?.id || "");
  const identifier = attrs.identifier || orderId;
  const logBase = {
    tenant_id: tenantId,
    function_name: "applyTokenPackOrder",
    extra: {
      order_id: orderId || null,
      identifier: identifier || null,
      variant_id: variantId ?? null,
      event_name: orderPayload?.meta?.event_name || null,
    },
  };

  const variant = getVariantInfo(variantId);
  if (!variant || variant.kind !== "token_pack") {
    logInfo("[lemonsqueezyWebhook] applyTokenPackOrder: skip (not token_pack)", {
      ...logBase,
      extra: { ...logBase.extra, variant_kind: variant?.kind || null },
    });
    return;
  }

  logInfo("[lemonsqueezyWebhook] applyTokenPackOrder: start", {
    ...logBase,
    extra: { ...logBase.extra, tokens: variant.tokens },
  });

  // ✅ addon_token(토큰팩) 단건 구매도 payments 서브컬렉션에 기록 (구매 히스토리/정산/감사용)
  // - webhook 재전송에도 동일 paymentId로 upsert되어 idempotent
  // - pack doc가 이미 존재하더라도, 과거 버그로 payment snapshot이 누락된 경우를 복구할 수 있음
  const createdAt = parseIsoToMs(attrs.created_at) || null;
  const { amount, amountCents, source: amountSource } = parseOrderAmount(attrs);

  const currency = String(attrs.currency || attrs.currency_code || "").toUpperCase();
  const status = String(attrs.status || "paid");

  // plan은 "현재 테넌트 플랜"로 남겨두고, kind로 구분 (UI/쿼리 호환성 유지)
  const { tenantRef, tenantSnap } = await requireTenantDocOrCapture(tenantId, {
    event_name: orderPayload?.meta?.event_name || null,
    webhook_id: orderPayload?.meta?.webhook_id || null,
    order_id: orderId || null,
    identifier: identifier || null,
    variant_id: variantId ?? null,
  });
  if (!tenantSnap) {
    logWarn("[lemonsqueezyWebhook] applyTokenPackOrder: tenant not found, skip writes", logBase);
    return;
  }
  const tenantPlan = tenantSnap.exists ? String(tenantSnap.data()?.plan || "FREE") : "FREE";

  await upsertPaymentSnapshot(tenantId, {
    paymentId: `order_${identifier}`,
    kind: "addon_token",
    plan: tenantPlan,
    status,
    customer_ref: String(attrs.customer_id || ""),
    subscription_ref: "",
    order_ref: orderId || identifier,
    variant_id: variantId ?? null,
    currency,
    amount,
    amount_cents: amountCents,
    created_at: createdAt,
  });
  logInfo("[lemonsqueezyWebhook] applyTokenPackOrder: payment snapshot upserted", {
    ...logBase,
    extra: {
      ...logBase.extra,
      payment_id: `order_${identifier}`,
      currency,
      amount,
      amount_cents: amountCents,
      amount_source: amountSource,
      status,
      created_at: createdAt,
    },
  });

  const packsRef = store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.ADDON_PACKS);
  // 하위 호환: 과거에는 pack 문서 id가 시간 기반(pack_${identifier}_${now})이어서,
  // payment_id 필드로 기존 적립 여부를 먼저 확인한다.
  const existing = await packsRef
    .where("payment_id", "==", identifier)
    .limit(1)
    .get();
  if (!existing.empty) {
    // ✅ 복구 로직: 과거 버그/부분 실패로 pack은 있는데 addon_token만 빠진 케이스를 보완
    // - 이미 pack이 존재하더라도 tenant.addon_token에 payment_id가 없다면 append 시도
    logWarn("[lemonsqueezyWebhook] applyTokenPackOrder: pack already exists (ensure addon_token granted)", {
      ...logBase,
      extra: { ...logBase.extra, existing_pack_doc_id: existing.docs?.[0]?.id || null },
    });

    const existingPackRef = existing.docs[0].ref;
    await store.runTransaction(async (tx) => {
      const [tSnap, pSnap] = await Promise.all([
        tx.get(tenantRef),
        tx.get(existingPackRef),
      ]);
      if (!tSnap.exists) return;
      const current = tSnap.data() || {};
      const addonTokenArr = Array.isArray(current.addon_token)
        ? [...current.addon_token]
        : [];
      const alreadyGranted = addonTokenArr.some(
        (p) => String(p?.payment_id || "") === String(identifier)
      );
      if (alreadyGranted) {
        return;
      }

      const now = Date.now();
      const pack = pSnap.exists ? (pSnap.data() || {}) : {};
      const expiresAtRaw = pack.expires_at ?? pack.active_pack_expires_at ?? null;
      const expiresAt =
        typeof expiresAtRaw === "number"
          ? expiresAtRaw
          : (typeof expiresAtRaw?.toMillis === "function" ? expiresAtRaw.toMillis() : null) ||
            (now + TOKEN_PACK_EXPIRY_MS);
      const tokenBalanceRaw = pack.remaining ?? pack.token_balance ?? pack.total ?? variant.tokens;
      const tokenBalance =
        typeof tokenBalanceRaw === "number"
          ? tokenBalanceRaw
          : Number(tokenBalanceRaw) || variant.tokens;

      addonTokenArr.push({
        payment_id: identifier,
        status: "active",
        active_pack_expires_at: expiresAt,
        token_balance: tokenBalance,
        token_used: 0,
        updated_at: now,
      });

      tx.update(tenantRef, {
        addon_token: addonTokenArr,
        updated_at: now,
      });
    });

    logInfo("[lemonsqueezyWebhook] applyTokenPackOrder: ensured addon_token for existing pack", logBase);
    return;
  }

  // ✅ 강한 멱등성 보장:
  // - doc id를 identifier 기반으로 고정하고, transaction.create로 "동시 중복 웹훅"에서도 1회만 생성되게 함
  // - tenant.addon_token 업데이트도 같은 트랜잭션에서 payment_id 기준으로 중복 append를 방지
  const packDocId = `pack_${identifier}`;
  const packRef = packsRef.doc(packDocId);

  await store.runTransaction(async (tx) => {
    const [packSnap, tSnap] = await Promise.all([
      tx.get(packRef),
      tx.get(tenantRef),
    ]);

    // 이미 생성되어 있으면(동시 웹훅 포함) 아무것도 하지 않음
    if (packSnap.exists) {
      return;
    }
    if (!tSnap.exists) {
      return;
    }

    const now = Date.now();
    const totalTokens = variant.tokens;
    const expiresAt = now + TOKEN_PACK_EXPIRY_MS;

    // 1) addon_pack 생성 (idempotent via create)
    tx.create(packRef, {
      pack_type: "token",
      total: String(totalTokens),
      tenant_id: tenantId,
      remaining: totalTokens,
      purchased_at: now,
      expires_at: expiresAt,
      payment_id: identifier,
      order_id: orderId || "",
      variant_id: variantId ?? null,
    });

    // 2) tenant.addon_token append (payment_id로 중복 방지)
    const current = tSnap.data() || {};
    const addonTokenArr = Array.isArray(current.addon_token)
      ? [...current.addon_token]
      : [];
    const alreadyGranted = addonTokenArr.some(
      (p) => String(p?.payment_id || "") === String(identifier)
    );
    if (!alreadyGranted) {
      addonTokenArr.push({
        payment_id: identifier,
        status: "active",
        active_pack_expires_at: expiresAt,
        token_balance: totalTokens,
        token_used: 0,
        updated_at: now,
      });
    }

    tx.update(tenantRef, {
      addon_token: addonTokenArr,
      updated_at: now,
    });
  });

  logInfo("[lemonsqueezyWebhook] applyTokenPackOrder: granted addon_token and created pack", logBase);
}

/**
 * Handle subscription lifecycle events (data.type === "subscriptions"):
 * - Always upsert payment snapshot.
 * - Do NOT grant paid benefits on subscription_created (it can arrive before first payment succeeds).
 * - subscription_cancelled + ends_at 미래: Lemon 유예 기간 → tenant.plan/payment.status 는 유지, 취소 예약 메타만 기록.
 * - subscription_expired 또는 실질 종료: tenant.plan 을 FREE 등으로 내림.
 * - subscription_updated 는 plan 변경을 반영하지 않고, 취소 예약/철회 메타만 반영합니다.
 */
async function handleSubscriptionEvent(tenantId, _eventName, data) {
  const type = data?.type;
  const attrs = data?.attributes || {};
  if (type !== "subscriptions") return;

  const { tenantSnap } = await requireTenantDocOrCapture(tenantId, {
    event_name: _eventName,
    subscription_id: String(data?.id || ""),
    variant_id: attrs.variant_id ?? null,
  });
  if (!tenantSnap) return;

  const variantId = attrs.variant_id;
  const variant = getVariantInfo(variantId);
  const plan = variant?.plan || "FREE";
  const status = mapSubscriptionStatus(attrs.status);
  const subId = String(data?.id || "");
  const now = Date.now();

  const lsRaw = String(attrs.status || "").toLowerCase();
  const endsAtMs = parseIsoToMs(attrs.ends_at);
  const inCancelGracePeriod =
    _eventName === "subscription_cancelled" &&
    (lsRaw === "cancelled" || lsRaw === "canceled") &&
    endsAtMs != null &&
    endsAtMs > now;
  const snapshotStatus = inCancelGracePeriod ? "active" : status;

  const currentPeriodStart = parseIsoToMs(attrs.created_at) || parseIsoToMs(attrs.renews_at);
  const currentPeriodEnd = parseIsoToMs(attrs.renews_at) || parseIsoToMs(attrs.ends_at);

  await upsertPaymentSnapshot(tenantId, {
    paymentId: `sub_${subId}`,
    kind: "subscription",
    plan,
    status: snapshotStatus,
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    customer_ref: String(attrs.customer_id || ""),
    customer_email: String(attrs.user_email || ""),
    subscription_ref: subId,
    order_ref: attrs.order_id != null ? String(attrs.order_id) : "",
    variant_id: variantId ?? null,
    created_at: parseIsoToMs(attrs.created_at) || null,
  });

  // ⚠️ Important: Do NOT grant paid benefits on subscription_created.
  // We only apply tenant.plan changes and usage reset on subscription_payment_success (invoice paid).
  if (_eventName === "subscription_created") {
    return;
  }

  const tenantRef = store.collection(Collection.TENANTS).doc(tenantId);

  let newPlan;
  if (inCancelGracePeriod) {
    newPlan = plan;
  } else if (status === "canceled" || status === "past_due") {
    newPlan = "FREE";
  } else {
    newPlan = plan;
  }

  // If subscription is cancelled/expired/past_due, any pending downgrade schedule is no longer meaningful.
  // Clear pending only when it matches this subscription.
  let shouldClearPending = false;
  const isTerminalOrProblem = status === "canceled" || status === "past_due";
  const isTerminalEvent =
    _eventName === "subscription_cancelled" || _eventName === "subscription_expired";

  // For terminal events, clear pending regardless of mapped status (avoid relying on status mapping).
  if (isTerminalOrProblem || isTerminalEvent) {
    const pending = tenantSnap?.exists ? tenantSnap.data()?.billing?.subscription_change_pending : null;
    shouldClearPending = pending && String(pending.subscription_id || "") === String(subId);
  }

  const cancelPendingExisting = tenantSnap.data()?.billing?.subscription_cancellation_pending || null;
  const shouldClearCancelPending =
    cancelPendingExisting &&
    String(cancelPendingExisting.subscription_id || "") === String(subId) &&
    (_eventName === "subscription_expired" || (!inCancelGracePeriod && newPlan === "FREE"));

  const updatePayload = { plan: newPlan, updated_at: now };
  const quota = getQuotaForPlan(newPlan);
  updatePayload["quota.dataset_limit"] = quota.dataset_limit;
  updatePayload["quota.row_limit_per_dataset"] = quota.row_limit_per_dataset;
  updatePayload["quota.token_limit_month"] = quota.token_limit_month;
  if (shouldClearPending) {
    updatePayload["billing.subscription_change_pending"] = null;
  }
  if (shouldClearCancelPending) {
    updatePayload["billing.subscription_cancellation_pending"] = null;
  } else if (inCancelGracePeriod) {
    updatePayload["billing.subscription_cancellation_pending"] = {
      status: "scheduled",
      subscription_id: subId,
      scheduled_at: now,
      effective_at: attrs.ends_at || null,
    };
  }

  await tenantRef.update(updatePayload);
  await syncPluginDefaultPlan(tenantId, newPlan, now);
}

/**
 * subscription_updated 는 plan/권한 반영에는 사용하지 않고,
 * Lemon 포털/PayPal fallback 등에서 들어오는 취소 예약/철회 메타만 동기화합니다.
 */
async function handleSubscriptionUpdated(tenantId, data) {
  const type = data?.type;
  const attrs = data?.attributes || {};
  if (type !== "subscriptions") return;

  const subId = String(data?.id || "");
  const variantId = attrs.variant_id;
  const variant = getVariantInfo(variantId);
  const plan = variant?.plan || "FREE";
  const status = mapSubscriptionStatus(attrs.status);
  const now = Date.now();
  const lsRaw = String(attrs.status || "").toLowerCase();
  const endsAtMs = parseIsoToMs(attrs.ends_at);
  const isCancelledFlag = attrs.cancelled === true;
  const isCancelledStatus = lsRaw === "cancelled" || lsRaw === "canceled";
  const inCancelGracePeriod =
    (isCancelledFlag || isCancelledStatus) && endsAtMs != null && endsAtMs > now;
  const cancellationResumed =
    attrs.cancelled === false && status !== "canceled" && status !== "past_due";

  if (!inCancelGracePeriod && !cancellationResumed) return;

  const { tenantRef, tenantSnap } = await requireTenantDocOrCapture(tenantId, {
    event_name: "subscription_updated",
    subscription_id: subId,
    variant_id: variantId ?? null,
  });
  if (!tenantSnap) return;

  await upsertPaymentSnapshot(tenantId, {
    paymentId: `sub_${subId}`,
    kind: "subscription",
    plan,
    // 취소 유예 중에도 화면/조회 기준은 active 로 유지하고, 예약 상태는 tenant.billing 에 둡니다.
    status: inCancelGracePeriod ? "active" : status,
    current_period_start: parseIsoToMs(attrs.created_at) || parseIsoToMs(attrs.renews_at),
    current_period_end: parseIsoToMs(attrs.renews_at) || parseIsoToMs(attrs.ends_at),
    customer_ref: String(attrs.customer_id || ""),
    customer_email: String(attrs.user_email || ""),
    subscription_ref: subId,
    order_ref: attrs.order_id != null ? String(attrs.order_id) : "",
    variant_id: variantId ?? null,
    created_at: parseIsoToMs(attrs.created_at) || null,
  });

  const updatePayload = { updated_at: now };
  if (inCancelGracePeriod) {
    updatePayload["billing.subscription_cancellation_pending"] = {
      status: "scheduled",
      subscription_id: subId,
      scheduled_at: now,
      effective_at: attrs.ends_at || null,
    };
  } else if (cancellationResumed) {
    updatePayload["billing.subscription_cancellation_pending"] = null;
  }

  await tenantRef.update(updatePayload);
}

async function resolveTenantIdFromSubscriptionRef(subId) {
  if (!subId) return null;
  const paymentsSnap = await store
    .collectionGroup(Collection.PAYMENTS)
    .where("subscription_ref", "==", String(subId))
    .limit(1)
    .get();
  if (paymentsSnap.empty) return null;
  const payDoc = paymentsSnap.docs[0];
  return String(payDoc.ref.parent.parent.id);
}

/**
 * subscription_payment_success sends a "subscription-invoices" object.
 * We fetch the latest subscription from Lemon Squeezy and update payment snapshot + tenant.plan
 * based on the paid/renewed variant (downgrade will be applied here at renewal).
 */
async function handleSubscriptionPaymentSuccess(body) {
  const data = body?.data;
  const attrs = data?.attributes || {};
  const invoiceId = String(data?.id || "");

  let subId = attrs.subscription_id || attrs.subscriptionId;
  if (!subId && data?.relationships?.subscription?.data?.id) {
    subId = data.relationships.subscription.data.id;
  }
  subId = String(subId || "");

  let tenantId = getTenantIdFromWebhook(body);
  if (!tenantId && subId) {
    tenantId = await resolveTenantIdFromSubscriptionRef(subId);
  }

  if (!tenantId || !subId) {
    logWarn("[lemonsqueezyWebhook] subscription_payment_success: missing tenant or subscription", {
      tenant_id: tenantId || "webhook",
      function_name: "lemonsqueezyWebhook",
      extra: { invoice_id: invoiceId, subscription_id: subId },
    });
    captureMessage(
      "[lemonsqueezyWebhook] subscription_payment_success missing tenant or subscription",
      "warning",
      {
        tenant_id: tenantId || "webhook",
        function_name: "lemonsqueezyWebhook",
        tags: { alert_code: "ls_payment_success_unmapped" },
        fingerprint: ["ls_payment_success_unmapped"],
        extra: { invoice_id: invoiceId, subscription_id: subId },
      }
    );
    return;
  }

  const { tenantRef, tenantSnap } = await requireTenantDocOrCapture(tenantId, {
    event_name: body?.meta?.event_name || null,
    webhook_id: body?.meta?.webhook_id || null,
    subscription_id: subId,
    invoice_id: invoiceId,
  });
  if (!tenantSnap) return;

  const client = lemonClient();
  const subRes = await client.get(`/subscriptions/${encodeURIComponent(subId)}`);
  const subData = subRes.data?.data;
  if (!subData || subData.type !== "subscriptions") {
    logWarn("[lemonsqueezyWebhook] subscription_payment_success: invalid subscription fetch response", {
      tenant_id: tenantId,
      function_name: "lemonsqueezyWebhook",
      extra: { invoice_id: invoiceId, subscription_id: subId },
    });
    captureMessage(
      "[lemonsqueezyWebhook] subscription_payment_success invalid subscription fetch",
      "warning",
      {
        tenant_id: tenantId,
        function_name: "lemonsqueezyWebhook",
        tags: { alert_code: "ls_payment_success_bad_subscription" },
        fingerprint: ["ls_payment_success_bad_subscription", tenantId],
        extra: { invoice_id: invoiceId, subscription_id: subId },
      }
    );
    return;
  }

  const subAttrs = subData.attributes || {};
  const variantId = subAttrs.variant_id;
  const variant = getVariantInfo(variantId);
  if (!variant || variant.kind !== "subscription") {
    logWarn("[lemonsqueezyWebhook] subscription_payment_success: unsupported variant_id", {
      tenant_id: tenantId,
      function_name: "lemonsqueezyWebhook",
      extra: { invoice_id: invoiceId, subscription_id: subId, variant_id: variantId },
    });
    captureMessage(
      "[lemonsqueezyWebhook] subscription_payment_success unsupported variant_id",
      "warning",
      {
        tenant_id: tenantId,
        function_name: "lemonsqueezyWebhook",
        tags: { alert_code: "ls_payment_success_bad_variant" },
        fingerprint: ["ls_payment_success_bad_variant", String(variantId || "none")],
        extra: { invoice_id: invoiceId, subscription_id: subId, variant_id: variantId },
      }
    );
    return;
  }

  const plan = variant.plan || "FREE";
  const status = mapSubscriptionStatus(subAttrs.status);
  const now = Date.now();
  const endsAtMsPay = parseIsoToMs(subAttrs.ends_at);
  const lsSubRaw = String(subAttrs.status || "").toLowerCase();
  const inCancelGracePayment =
    (lsSubRaw === "cancelled" || lsSubRaw === "canceled") &&
    endsAtMsPay != null &&
    endsAtMsPay > now;
  const snapshotStatus = inCancelGracePayment ? "active" : status;
  const currentPeriodStart = parseIsoToMs(subAttrs.created_at) || parseIsoToMs(subAttrs.renews_at);
  const currentPeriodEnd = parseIsoToMs(subAttrs.renews_at) || parseIsoToMs(subAttrs.ends_at);

  // Invoice money fields (subscription-invoices)
  const { amount, amountCents, source: amountSource } = parseOrderAmount(attrs);
  const currency = String(attrs.currency || attrs.currency_code || "").toUpperCase();
  const invoiceStatus = String(attrs.status || "");
  const billingReason = String(attrs.billing_reason || "");
  const invoiceCreatedAt = parseIsoToMs(attrs.created_at) || null;

  await upsertPaymentSnapshot(tenantId, {
    paymentId: `sub_${subId}`,
    kind: "subscription",
    plan,
    status: snapshotStatus,
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    customer_ref: String(subAttrs.customer_id || ""),
    customer_email: String(subAttrs.user_email || ""),
    subscription_ref: subId,
    variant_id: variantId ?? null,
    currency,
    amount,
    amount_cents: amountCents,
    invoice_ref: invoiceId,
    invoice_status: invoiceStatus,
    billing_reason: billingReason,
    created_at: invoiceCreatedAt,
  });
  logInfo("[lemonsqueezyWebhook] subscription_payment_success: payment snapshot upserted", {
    tenant_id: tenantId,
    function_name: "lemonsqueezyWebhook",
    extra: {
      subscription_id: subId,
      invoice_id: invoiceId,
      invoice_status: invoiceStatus,
      billing_reason: billingReason,
      currency,
      amount,
      amount_cents: amountCents,
      amount_source: amountSource,
    },
  });

  let newPlan;
  if (inCancelGracePayment) {
    newPlan = plan;
  } else if (status === "canceled" || status === "past_due") {
    newPlan = "FREE";
  } else {
    newPlan = plan;
  }

  const pending = tenantSnap.exists ? tenantSnap.data()?.billing?.subscription_change_pending : null;
  const cancelPending =
    tenantSnap.exists ? tenantSnap.data()?.billing?.subscription_cancellation_pending : null;
  const shouldClearCancelPendingSuccess =
    cancelPending &&
    String(cancelPending.subscription_id || "") === String(subId) &&
    subAttrs.cancelled !== true;

  const existingBilling = tenantSnap.exists ? tenantSnap.data()?.billing || {} : {};
  const shouldClearPending =
    pending &&
    String(pending.subscription_id || "") === String(subId) &&
    Number(pending.to_variant_id) === Number(variantId);

  // Prevent double-advancing window when we receive payment_failed then payment_success for the same invoice.
  const cycleKey = makeBillingCycleKey(subId, invoiceId);
  const alreadyAdvanced =
    cycleKey &&
    existingBilling?.last_billing_cycle_key === cycleKey;

  // Align billing window to Lemon Squeezy subscription period (handles month length, yearly, anchor shifts, etc.)
  const nextStartAt = currentPeriodStart != null ? Number(currentPeriodStart) : null;
  const nextEndAt = currentPeriodEnd != null ? Number(currentPeriodEnd) : null;
  const startDay = nextStartAt != null ? new Date(nextStartAt).getDate() : (existingBilling?.startDay ?? null);

  const updatePayload = {
    plan: newPlan,
    updated_at: now,
  };
  const quota = getQuotaForPlan(newPlan);
  updatePayload["quota.dataset_limit"] = quota.dataset_limit;
  updatePayload["quota.row_limit_per_dataset"] = quota.row_limit_per_dataset;
  updatePayload["quota.token_limit_month"] = quota.token_limit_month;
  if (shouldClearPending) {
    updatePayload["billing.subscription_change_pending"] = null;
  }
  if (shouldClearCancelPendingSuccess) {
    updatePayload["billing.subscription_cancellation_pending"] = null;
  }

  if (!alreadyAdvanced) {
    if (nextStartAt != null) updatePayload["billing.windowStartAt"] = Number(nextStartAt);
    if (nextEndAt != null) updatePayload["billing.windowEndAt"] = Number(nextEndAt);
    if (startDay != null) updatePayload["billing.startDay"] = Number(startDay);
    updatePayload["billing.last_billing_cycle_key"] = cycleKey;
    updatePayload["billing.last_billing_cycle_updated_at"] = now;
    // Reset billing-month usage on renewal once per cycle
    updatePayload["usage.token_used_billing_month"] = 0;
    // 토큰 부족 메일: 새 빌링 윈도우에서 다시 발송 가능
    updatePayload["alarm.tokenLowMailingSent50ThisWindow"] = false;
    updatePayload["alarm.tokenLowMailingSent10ThisWindow"] = false;
  }

  await tenantRef.update(updatePayload);
  await syncPluginDefaultPlan(tenantId, newPlan, now);
}

/**
 * subscription_payment_failed sends a "subscription-invoices" object (no subscription in body).
 * Set tenant.plan to FREE. tenantId from meta.custom_data; if missing, resolve by subscription_id.
 */
async function handleSubscriptionPaymentFailed(body) {
  let tenantId = getTenantIdFromWebhook(body);
  const data = body?.data;
  const attrs = data?.attributes || {};
  const invoiceId = String(data?.id || "");

  let subId = attrs.subscription_id || attrs.subscriptionId;
  if (!subId && data?.relationships?.subscription?.data?.id) {
    subId = data.relationships.subscription.data.id;
  }
  subId = String(subId || "");

  if (!tenantId && subId) {
    tenantId = await resolveTenantIdFromSubscriptionRef(subId);
  }

  if (!tenantId) {
    logWarn("[lemonsqueezyWebhook] subscription_payment_failed: no tenant_id or subscription_ref", {
      tenant_id: "webhook",
      function_name: "lemonsqueezyWebhook",
      subscription_id: subId,
      invoice_id: invoiceId,
    });
    captureMessage(
      "[lemonsqueezyWebhook] subscription_payment_failed missing tenant mapping",
      "error",
      {
        tenant_id: "webhook",
        function_name: "lemonsqueezyWebhook",
        tags: { alert_code: "ls_payment_failed_unmapped" },
        fingerprint: ["ls_payment_failed_unmapped"],
        extra: { subscription_id: subId, invoice_id: invoiceId },
      }
    );
    return;
  }

  await upsertPaymentSnapshot(tenantId, {
    paymentId: `sub_${subId}`,
    status: "past_due",
    subscription_ref: subId,
  });

  const tenantRef = store.collection(Collection.TENANTS).doc(tenantId);
  const now = Date.now();
  // 결제 실패 시에는 예약 다운그레이드가 남아있으면 혼란을 주므로 동일 subscription이면 정리
  const tenantSnap = await tenantRef.get();
  const pending = tenantSnap.exists ? tenantSnap.data()?.billing?.subscription_change_pending : null;
  const shouldClearPending =
    pending && String(pending.subscription_id || "") === String(subId);

  // Payment failure is NOT a renewal; keep existing billing window (lazy window rollover happens in updateTokenUsage).
  // Downgrade plan to FREE so paid features/quota are not applicable.
  const updatePayload = { plan: "FREE", updated_at: now };
  const quota = getQuotaForPlan("FREE");
  updatePayload["quota.dataset_limit"] = quota.dataset_limit;
  updatePayload["quota.row_limit_per_dataset"] = quota.row_limit_per_dataset;
  updatePayload["quota.token_limit_month"] = quota.token_limit_month;
  if (shouldClearPending) {
    updatePayload["billing.subscription_change_pending"] = null;
  }
  const cancelPendingFail = tenantSnap.data()?.billing?.subscription_cancellation_pending;
  if (cancelPendingFail && String(cancelPendingFail.subscription_id || "") === String(subId)) {
    updatePayload["billing.subscription_cancellation_pending"] = null;
  }
  await tenantRef.update(updatePayload);
  await syncPluginDefaultPlan(tenantId, "FREE", now);
}

/**
 * Handle order_created: if token pack variant, create addon_pack + addon_token.
 */
async function handleOrderCreated(tenantId, body) {
  const data = body?.data;
  if (!data || data.type !== "orders") return;

  const attrs = data.attributes || {};
  const firstItem = attrs.first_order_item;
  const variantId = firstItem?.variant_id;
  const variant = getVariantInfo(variantId);

  if (variant?.kind === "token_pack") {
    await applyTokenPackOrder(tenantId, body);
  }
}

const lemonsqueezyWebhook = onRequest(
  { timeoutSeconds: 60, memory: "512MiB" },
  sentryWrapper(async (req, res) => {
    const startedAt = Date.now();
    const traceContext = req.get("X-Cloud-Trace-Context") || "";
    const contentLength = Number(req.get("content-length") || 0) || null;
    const userAgent = req.get("user-agent") || "";
    const signatureHeader = req.get("X-Signature") || "";

    // Health check shortcut (Statuspage/Uptime). Avoid signature + method checks.
    if (req.headers["x-health-check"]) {
      return res.status(200).json({ status: "ok" });
    }

    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    logInfo("[lemonsqueezyWebhook] Request start", {
      tenant_id: "webhook",
      function_name: "lemonsqueezyWebhook",
      extra: {
        trace: traceContext,
        method: req.method,
        url: req?.url || req?.path || "/",
        content_length: contentLength,
        user_agent: userAgent,
        has_signature_header: !!signatureHeader,
        signature_header_len: signatureHeader ? String(signatureHeader).length : 0,
        readable_ended: !!req?.readableEnded,
        body_type: typeof req.body,
      },
    });

    if (!req?.rawBody || !(req.rawBody instanceof Buffer)) {
      logWarn("[lemonsqueezyWebhook] Missing rawBody", {
        tenant_id: "webhook",
        function_name: "lemonsqueezyWebhook",
        extra: {
          trace: traceContext,
          waited_ms: Date.now() - startedAt,
          raw_body_type: typeof req?.rawBody,
          raw_body_is_buffer: !!req?.rawBody && req.rawBody instanceof Buffer,
        },
      });
      return res.status(400).send("Bad Request");
    }

    if (!verifyWebhookSignature(req)) {
      logWarn("[lemonsqueezyWebhook] Invalid signature", {
        tenant_id: "webhook",
        function_name: "lemonsqueezyWebhook",
        extra: {
          trace: traceContext,
          waited_ms: Date.now() - startedAt,
          raw_body_bytes: req?.rawBody?.length || 0,
          signature_header_len: signatureHeader ? String(signatureHeader).length : 0,
        },
      });
      return res.status(401).send("Invalid signature");
    }

    let payload;
    try {
      payload = JSON.parse(req.rawBody.toString("utf-8"));
    } catch (e) {
      logWarn("[lemonsqueezyWebhook] Invalid JSON", {
        tenant_id: "webhook",
        function_name: "lemonsqueezyWebhook",
        extra: {
          trace: traceContext,
          waited_ms: Date.now() - startedAt,
          raw_body_bytes: req?.rawBody?.length || 0,
        },
      });
      return res.status(400).send("Invalid JSON");
    }

    const eventName = req.get("X-Event-Name") || payload?.meta?.event_name;
    let tenantId = getTenantIdFromWebhook(payload);

    try {
      const data = payload?.data;
      logInfo("[lemonsqueezyWebhook] Dispatch start", {
        tenant_id: tenantId || "webhook",
        function_name: "lemonsqueezyWebhook",
        extra: {
          trace: traceContext,
          waited_ms: Date.now() - startedAt,
          event_name: eventName || null,
          data_type: data?.type || null,
        },
      });

      if (eventName === "subscription_payment_failed") {
        await handleSubscriptionPaymentFailed(payload);
        logInfo("[lemonsqueezyWebhook] Dispatch done", {
          tenant_id: tenantId || "webhook",
          function_name: "lemonsqueezyWebhook",
          extra: { trace: traceContext, event_name: eventName, total_ms: Date.now() - startedAt },
        });
        return res.status(200).json({ received: true });
      }

      if (eventName === "subscription_payment_success") {
        await handleSubscriptionPaymentSuccess(payload);
        logInfo("[lemonsqueezyWebhook] Dispatch done", {
          tenant_id: tenantId || "webhook",
          function_name: "lemonsqueezyWebhook",
          extra: { trace: traceContext, event_name: eventName, total_ms: Date.now() - startedAt },
        });
        return res.status(200).json({ received: true });
      }

      if (!tenantId) {
        logWarn("[lemonsqueezyWebhook] No tenant_id in custom_data", {
          tenant_id: "webhook",
          function_name: "lemonsqueezyWebhook",
          extra: { event_name: eventName },
        });
        captureMessage(
          "[lemonsqueezyWebhook] No tenant_id in custom_data",
          "warning",
          {
            tenant_id: "webhook",
            function_name: "lemonsqueezyWebhook",
            tags: { alert_code: "ls_webhook_missing_tenant" },
            fingerprint: ["ls_webhook_missing_tenant", String(eventName || "unknown")],
            extra: { event_name: eventName },
          }
        );
        logInfo("[lemonsqueezyWebhook] Dispatch done (no tenant_id)", {
          tenant_id: "webhook",
          function_name: "lemonsqueezyWebhook",
          extra: { trace: traceContext, event_name: eventName || null, total_ms: Date.now() - startedAt },
        });
        return res.status(200).json({ received: true });
      }

      switch (eventName) {
        case "order_created":
          await handleOrderCreated(tenantId, payload);
          break;
        case "subscription_created":
          await handleSubscriptionEvent(tenantId, eventName, data);
          break;
        case "subscription_updated":
          await handleSubscriptionUpdated(tenantId, data);
          break;
        case "subscription_cancelled":
        case "subscription_expired":
          await handleSubscriptionEvent(tenantId, eventName, data);
          break;
        default:
          logInfo("[lemonsqueezyWebhook] Unhandled event", {
            tenant_id: tenantId || "webhook",
            function_name: "lemonsqueezyWebhook",
            extra: { event_name: eventName, tenant_id: tenantId },
          });
      }
    } catch (err) {
      const isCriticalBillingEvent = [
        "subscription_created",
        "subscription_payment_success",
        "order_created",
        "subscription_cancelled",
        "subscription_expired",
      ].includes(eventName);

      logAndCaptureError(err, "[lemonsqueezyWebhook] Billing flow failed (internal)", {
        tenant_id: tenantId || "webhook",
        function_name: "lemonsqueezyWebhook",
        extra: {
          event_name: eventName,
          tenant_id: tenantId,
          billing_internal_failure: true,
          is_critical_billing_event: isCriticalBillingEvent,
        },
      });
      return res.status(500).json({ error: "Internal error" });
    }

    logInfo("[lemonsqueezyWebhook] Request done", {
      tenant_id: tenantId || "webhook",
      function_name: "lemonsqueezyWebhook",
      extra: {
        trace: traceContext,
        event_name: eventName || null,
        total_ms: Date.now() - startedAt,
      },
    });
    return res.status(200).json({ received: true });
  })
);

module.exports = lemonsqueezyWebhook;