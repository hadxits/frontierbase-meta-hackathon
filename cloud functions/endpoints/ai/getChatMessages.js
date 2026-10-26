/**
 * ============================================================================
 * getChatMessages.js - tenants/{tenantId}/chats/{chatId}/messages 목록 반환
 * ============================================================================
 *
 * plugin_key(tenant_id) 와 conversation_id(세션의 cid) 기준으로
 * Firestore tenants/{tenantId}/chats/{chatId}/messages 서브컬렉션을 조회해
 * 메시지 목록을 전부 반환합니다.
 *
 * Gateway 경유: POST /messages, Bearer 토큰에서 cid → conversation_id,
 * body.plugin_key → tenant_id 로 설정 후 호출됩니다.
 * ============================================================================
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");

const MESSAGES_LIMIT = 500;

/**
 * Firestore Timestamp 또는 number를 밀리초 숫자로 반환
 */
function toMillis(value) {
  if (value == null) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  return null;
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getChatMessages(req, res) {
  const tenant_id =
    req.body?.tenant_id != null ? String(req.body.tenant_id).trim() : "";
  const conversation_id =
    req.body?.conversation_id != null
      ? String(req.body.conversation_id).trim()
      : "";

  if (!tenant_id || !conversation_id) {
    return res.status(400).json({
      status: "error",
      errorCode: "INVALID_REQUEST",
      message: "tenant_id and conversation_id are required.",
    });
  }

  const messagesRef = store
    .collection(Collection.TENANTS)
    .doc(tenant_id)
    .collection(Collection.CHATS)
    .doc(conversation_id)
    .collection(Collection.CHAT_MESSAGES);

  // 최신 데이터 기준 500개만 조회 후, 응답은 시간순(오래된 것 먼저)으로 반환
  const snapshot = await messagesRef
    .orderBy("created_at", "desc")
    .limit(MESSAGES_LIMIT)
    .get();

  const messages = snapshot.docs
    .reverse()
    .map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        role: d.role ?? null,
        content: d.content ?? null,
        created_at: toMillis(d.created_at) ?? null,
        locale: d.locale ?? null,
      };
    });

  return res.status(200).json({
    status: "success",
    message: "Request successful",
    data: { messages },
  });
}

module.exports = getChatMessages;