const { db } = require("@/firebase");

const RTDB_USER_PATH = "User";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function parseUserQuerySnapshot(snapshot) {
  if (!snapshot?.exists?.()) return null;
  const raw = snapshot.val();
  if (!raw || typeof raw !== "object") return null;

  const entries = Object.entries(raw);
  if (!entries.length) return null;

  const [uidKey, data] = entries[0];
  const record = data && typeof data === "object" ? data : {};
  const uid = String(record.uid || uidKey || "").trim();
  if (!uid) return null;

  return { uid, ...record };
}

async function findRtdbUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const snapshot = await db
    .ref(RTDB_USER_PATH)
    .orderByChild("email")
    .equalTo(normalized)
    .limitToFirst(1)
    .get();

  return parseUserQuerySnapshot(snapshot);
}

function isRtdbEmailOtpEnabled(userRecord) {
  return userRecord?.security?.emailOtpEnabled === true;
}

function isRtdbAuthenticatorEnabled(userRecord) {
  return userRecord?.security?.authenticatorEnabled === true;
}

async function isEmailOtpEnabledForEmail(email) {
  const user = await findRtdbUserByEmail(email);
  if (!user) return false;
  return isRtdbEmailOtpEnabled(user);
}

module.exports = {
  RTDB_USER_PATH,
  parseUserQuerySnapshot,
  findRtdbUserByEmail,
  isRtdbEmailOtpEnabled,
  isRtdbAuthenticatorEnabled,
  isEmailOtpEnabledForEmail
};