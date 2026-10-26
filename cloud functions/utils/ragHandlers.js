const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { FieldValue } = require("firebase-admin/firestore");
const {
  detectLanguageAndGetNoResultMessage,
  getNoDatasetsMessage
} = require("@/utils/localization");
const { logInfo } = require("@/utils/logger");
const { getCachedTenant, setCachedTenant } = require("@/utils/memoryCache");
const { elapsedResponseSeconds } = require("@/utils/responseTime");
const { recordUnansweredQuestion } = require("@/utils/chatAnalytics");

// RAG 결과 없음 처리 함수 (중복 코드 제거)
// ✅ FIX: currentUserEmbed 파라미터 추가 및 last_user_embed 갱신
async function handleNoRagResult({
                                   tenant_id,
                                   conversation_id,
                                   message,
                                   locale,
                                   chat,
                                   chatRef,
                                   send,
                                   closed,
                                   ping,
                                   res,
  logReason,
  currentUserEmbed = null,
  noDatasetsCase = false,
  rag_flow_trace = null,
  responseText = null,
  effectiveEmail = "",
  effectivePhotoURL = "",
  questionType = "unknown",
  unansweredRagResultType = "no_result",
  ragSources = null,
  /** @type {number|undefined} streamChatRag 핸들러 진입 시각 (Date.now) */
  requestStartedAtMs,
  /** widget Issue Track: plugin flag && !gateway */
  enableEscalation = false
}) {
  logInfo(`[streamChatRag] ${logReason}`, {
    tenant_id,
    conversation_id,
    function_name: "handleNoRagResult"
  });

  // 언어별 메시지 전송 (등록된 데이터셋 없음/전부 삭제 시 전용 메시지)
  const noResultMessage =
    typeof responseText === "string" && responseText.trim().length > 0
      ? responseText.trim()
      : noDatasetsCase
        ? getNoDatasetsMessage(locale)
        : detectLanguageAndGetNoResultMessage(locale);

  const resolvedEmailEarly =
    (typeof effectiveEmail === "string" && effectiveEmail.trim()
      ? effectiveEmail.trim()
      : "") ||
    (typeof chat?.email === "string" && chat.email.trim()
      ? chat.email.trim()
      : "");
  const offerEscalation =
    enableEscalation === true &&
    !noDatasetsCase &&
    unansweredRagResultType !== "clarify" &&
    unansweredRagResultType !== "no_datasets";
  // 본문(no-result)은 항상 스트림. Issue Track 카드는 위젯에서 추가로 붙임.
  send("status", { text: noResultMessage });
  send("delta", { text: noResultMessage });
  if (offerEscalation) {
    const escalationPayload = {
      offered: true,
      has_email: !!resolvedEmailEarly,
      conversation_id,
    };
    send("offer_escalation", escalationPayload);
    send("done", {
      ok: true,
      text: noResultMessage,
      escalation: escalationPayload,
    });
  } else {
    send("done", { ok: true, text: noResultMessage });
  }

  // 메시지 저장
  const now = Date.now();
  const messageText =
    typeof message === "string"
      ? message.trim()
      : String(message || "").trim();
  const messagesRef = store
      .collection(Collection.TENANTS)
      .doc(tenant_id)
      .collection(Collection.CHATS)
      .doc(conversation_id)
      .collection(Collection.CHAT_MESSAGES);

  const response_seconds = elapsedResponseSeconds(requestStartedAtMs);
  const resolvedEmail = resolvedEmailEarly;
  const resolvedPhotoURL =
    (typeof effectivePhotoURL === "string" && effectivePhotoURL.trim()
      ? effectivePhotoURL.trim()
      : "") ||
    (typeof chat?.userPhotoURL === "string" && chat.userPhotoURL.trim()
      ? chat.userPhotoURL.trim()
      : "");

  // 메시지 병렬 저장 (성능 최적화)
  const userMessageRef = messagesRef.doc();
  const assistantMessageRef = messagesRef.doc();
  await Promise.all([
    userMessageRef.set({
      role: "user",
      content: message,
      created_at: now,
      locale: locale || null,
      response_seconds,
      ...(resolvedEmail ? { email: resolvedEmail } : {}),
      ...(resolvedPhotoURL ? { userPhotoURL: resolvedPhotoURL } : {})
    }),
    // data_not_found: 데이터 못 찾음 플래그. no_result_question: 해당 시점 사용자 질문(분석용).
    // Issue Track 오퍼여도 본문(no-result)은 유지. 카드는 위젯 추가 UI.
    assistantMessageRef.set({
      role: "assistant",
      content: noResultMessage,
      created_at: now,
      rag_refs: null,
      rag_result_type: "no_result",
      data_not_found: true,
      no_result_question: messageText,
      rag_flow_trace: Array.isArray(rag_flow_trace) ? rag_flow_trace : [],
      response_seconds,
      ...(offerEscalation
        ? {
            escalation: {
              offered: true,
              has_email: !!resolvedEmail,
            },
          }
        : {}),
      ...(resolvedEmail ? { email: resolvedEmail } : {}),
      ...(resolvedPhotoURL ? { userPhotoURL: resolvedPhotoURL } : {})
    })
  ]);

  recordUnansweredQuestion({
    tenantId: tenant_id,
    conversationId: conversation_id,
    question: messageText,
    assistantResponse: noResultMessage,
    ragResultType: unansweredRagResultType,
    questionType,
    locale,
    ragSources: Array.isArray(ragSources) ? ragSources : [],
    userMessageId: userMessageRef.id,
    assistantMessageId: assistantMessageRef.id
  }).catch((err) => {
    logInfo("[handleNoRagResult] recordUnansweredQuestion failed", {
      tenant_id,
      conversation_id,
      function_name: "handleNoRagResult",
      extra: { error: err?.message || String(err) }
    });
  });

  // ✅ FIX: Chat 문서 업데이트 시 last_user_embed 항상 갱신
  const updateData = {
    updated_at: now,
    message_count: (chat.message_count || 0) + 2
  };

  // ✅ FIX: last_user_embed 갱신 (vec가 있으면 포함, 없으면 text/at만)
  if (currentUserEmbed && currentUserEmbed.vec) {
    updateData.last_user_embed = {
      at: currentUserEmbed.at || now,
      text: currentUserEmbed.text || messageText,
      vec: currentUserEmbed.vec
    };
  } else {
    updateData.last_user_embed = {
      at: now,
      text: messageText
    };
  }

  updateData.last_message_at = now;
  if (resolvedEmail) {
    updateData.email = resolvedEmail;
  }
  if (resolvedPhotoURL) {
    updateData.userPhotoURL = resolvedPhotoURL;
  }

  // chat 메타: update()는 문서 없으면 NOT_FOUND → set(..., { merge: true })로 upsert
  // created_at/state 등은 최초 1회만 넣어 이후 merge에서 덮어쓰지 않음
  const chatSnap = await chatRef.get();
  const payload = { ...updateData };
  if (!chatSnap.exists) {
    Object.assign(payload, {
      created_at: now,
      state: null,
      customer_profile: null
    });
  }
  await chatRef.set(payload, { merge: true });

  // Usage 증가 (message만)
  // 날짜 키 생성 최적화 (중복 제거)
  const nowISO = new Date(now).toISOString();
  const dailyKey = nowISO.split("T")[0];
  const monthKey = nowISO.slice(0, 7);

  // Firestore 트랜잭션: 모든 read를 write보다 먼저 수행해야 함
  const tenantRef = store.collection(Collection.TENANTS).doc(tenant_id);
  const dailyRef = store
      .collection(Collection.TENANTS)
      .doc(tenant_id)
      .collection(Collection.USAGE_DAILY)
      .doc(dailyKey);
  const monthlyRef = store
      .collection(Collection.TENANTS)
      .doc(tenant_id)
      .collection(Collection.USAGE_MONTHLY)
      .doc(monthKey);

  let updatedMessageUsedMonth = null;
  let updatedMessageUsedToday = null;
  await store.runTransaction(async (transaction) => {
    const [tenantSnap, dailySnap, monthlySnap] = await Promise.all([
      transaction.get(tenantRef),
      transaction.get(dailyRef),
      transaction.get(monthlyRef)
    ]);

    const currentTenant = tenantSnap.data() || {};
    const currentUsage = currentTenant.usage || {};
    const newMessageUsedMonth = (currentUsage.message_used_month || 0) + 1;
    updatedMessageUsedMonth = newMessageUsedMonth;

    // message_used_today: 같은 날이면 +1, 날짜가 바뀌었으면 1 (lastUpdatedDate 기준)
    const lastUpdatedDate = currentUsage.lastUpdatedDate;
    const shouldResetToday = lastUpdatedDate && lastUpdatedDate !== dailyKey;
    const newMessageUsedToday = shouldResetToday
      ? 1
      : (currentUsage.message_used_today || 0) + 1;
    updatedMessageUsedToday = newMessageUsedToday;

    const dailyData = dailySnap.exists ? dailySnap.data() : {};
    const monthlyData = monthlySnap.exists ? monthlySnap.data() : {};

    transaction.update(tenantRef, {
      "usage.message_used_month": newMessageUsedMonth,
      "usage.message_used_today": newMessageUsedToday,
      "usage.lastUpdatedDate": dailyKey
    });
    transaction.set(
        dailyRef,
        {
          tenant_id,
          date_key: dailyKey,
          month_key: monthKey,
          date: dailyKey,
          // 신규 스키마: message.total 중첩 필드 사용
          message: { total: FieldValue.increment(1) },
          message_count: (dailyData.message_count || 0) + 1,
          token_count: dailyData.token_count || 0,
          updated_at: now
        },
        { merge: true }
    );
    if (!dailySnap.exists) {
      transaction.set(dailyRef, { created_at: now }, { merge: true });
    }
    transaction.set(
        monthlyRef,
        {
          tenant_id,
          month_key: monthKey,
          month: monthKey,
          message: { total: FieldValue.increment(1) },
          message_count: (monthlyData.message_count || 0) + 1,
          token_count: monthlyData.token_count || 0,
          updated_at: now
        },
        { merge: true }
    );
    if (!monthlySnap.exists) {
      transaction.set(monthlyRef, { created_at: now }, { merge: true });
    }
  });

  // 캐시 업데이트 (message_used_month, message_used_today 업데이트 후 캐시 동기화)
  if (updatedMessageUsedMonth !== null || updatedMessageUsedToday !== null) {
    const cachedTenant = getCachedTenant(tenant_id);
    if (cachedTenant) {
      if (!cachedTenant.usage) {
        cachedTenant.usage = {};
      }
      if (updatedMessageUsedMonth !== null) {
        cachedTenant.usage.message_used_month = updatedMessageUsedMonth;
      }
      if (updatedMessageUsedToday !== null) {
        cachedTenant.usage.message_used_today = updatedMessageUsedToday;
        cachedTenant.usage.lastUpdatedDate = dailyKey;
      }
      setCachedTenant(tenant_id, cachedTenant);
      logInfo("[handleNoRagResult] Tenant cache updated with message_used_month / message_used_today", {
        tenant_id,
        conversation_id,
        function_name: "handleNoRagResult"
      });
    }
  }

  closed.value = true;
  if (ping != null) clearInterval(ping);
  logInfo(`[streamChatRag] Request completed (${logReason})`, {
    tenant_id,
    conversation_id,
    function_name: "handleNoRagResult"
  });
  res.end();
}

module.exports = {
  handleNoRagResult
};