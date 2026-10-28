/**
 * Issue Track (KB-miss escalation) helpers
 * Flag: tenants/{tenantId}/plugin/default.issue_track_enabled
 */
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");

const PLUGIN_DEFAULT_ID = "default";
const ISSUE_TRACK_STATUSES = ["open", "in_progress", "resolved", "closed"];

/**
 * @param {object|null|undefined} pluginData
 * @returns {boolean}
 */
function isIssueTrackEnabled(pluginData) {
  return pluginData?.issue_track_enabled === true;
}

/**
 * The Gateway(/chat) route always returns false, ignoring flags.
 * @param {object} opts
 * @param {import('express').Request|object} [opts.req]
 * @param {boolean} [opts.isGateway]
 * @param {object|null|undefined} [opts.pluginData]
 * @returns {boolean}
 */
function resolveEnableEscalation({ req, isGateway, pluginData } = {}) {
  const gateway =
    isGateway === true ||
    String(req?.headers?.["x-internal-gateway"] || "") === "1";
  if (gateway) return false;
  return isIssueTrackEnabled(pluginData);
}

/**
 * @param {string} tenantId
 * @returns {Promise<{ ref: FirebaseFirestore.DocumentReference, data: object|null }>}
 */
async function loadPluginDefault(tenantId) {
  const id = String(tenantId || "").trim();
  if (!id) return { ref: null, data: null };
  const ref = store
    .collection(Collection.TENANTS)
    .doc(id)
    .collection(Collection.PLUGIN)
    .doc(PLUGIN_DEFAULT_ID);
  const snap = await ref.get();
  return { ref, data: snap.exists ? snap.data() || {} : null };
}

/**
 * @param {string} tenantId
 * @returns {Promise<boolean>}
 */
async function isIssueTrackEnabledForTenant(tenantId) {
  const { data } = await loadPluginDefault(tenantId);
  return isIssueTrackEnabled(data);
}

function isValidIssueStatus(status) {
  return ISSUE_TRACK_STATUSES.includes(String(status || "").trim());
}

function isValidContactEmail(email) {
  const s = String(email || "").trim();
  return s.length > 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * @param {string} tenantId
 * @param {string} conversationId
 * @param {number} [limit=40]
 * @returns {Promise<Array<{ role: string, content: string, created_at: number }>>}
 */
async function loadConversationTranscript(tenantId, conversationId, limit = 40) {
  const tid = String(tenantId || "").trim();
  const cid = String(conversationId || "").trim();
  if (!tid || !cid) return [];

  const snap = await store
    .collection(Collection.TENANTS)
    .doc(tid)
    .collection(Collection.CHATS)
    .doc(cid)
    .collection(Collection.CHAT_MESSAGES)
    .orderBy("created_at", "desc")
    .limit(Math.max(1, Math.min(Number(limit) || 40, 100)))
    .get();

  const rows = snap.docs.map((doc) => {
    const d = doc.data() || {};
    return {
      role: String(d.role || ""),
      content: String(d.content || ""),
      created_at: typeof d.created_at === "number" ? d.created_at : 0,
    };
  });
  rows.reverse();
  return rows;
}

/**
 * @param {Array<{ role: string, content: string }>} messages
 * @param {string} [locale]
 * @returns {string}
 */
function formatTranscriptPlain(messages, locale) {
  const { getIssueTrackCopy } = require("@/utils/localization");
  const copy = getIssueTrackCopy(locale);
  if (!Array.isArray(messages) || messages.length === 0) return copy.noMessages;
  return messages
    .map((m) => {
      const role =
        m.role === "assistant"
          ? copy.assistant
          : m.role === "user"
            ? copy.user
            : m.role || copy.unknown;
      const content = String(m.content || "").trim();
      return `[${role}]\n${content}`;
    })
    .join("\n\n");
}

module.exports = {
  PLUGIN_DEFAULT_ID,
  ISSUE_TRACK_STATUSES,
  isIssueTrackEnabled,
  resolveEnableEscalation,
  loadPluginDefault,
  isIssueTrackEnabledForTenant,
  isValidIssueStatus,
  isValidContactEmail,
  loadConversationTranscript,
  formatTranscriptPlain,
};