/**
 * ============================================================================
 * getChatMessages.js - Returns list of tenants/{tenantId}/chats/{chatId}/messages
 * ============================================================================
 *
 * Based on plugin_key (tenant_id) and conversation_id (session cid)
 * Query Firestore tenants/{tenantId}/chats/{chatId}/messages subcollection
 * Return all messages.
 *
 * Via Gateway: POST /messages, cid from Bearer token → conversation_id,
 * body.plugin_key → tenant_id, then called.
 * ============================================================================
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");

const MESSAGES_LIMIT = 500;

/**
 * Return Firestore Timestamp or number as milliseconds
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

  // Query only the latest 500 records, respond in chronological order (oldest first)
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