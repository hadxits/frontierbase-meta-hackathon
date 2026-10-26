const { auth, db } = require("@/firebase");
const { RTDB_USER_PATH } = require("@/utils/rtdbUser");

const TOTP_FACTOR_ID = "totp";

function isTotpFactor(factor) {
  return String(factor?.factorId || "") === TOTP_FACTOR_ID;
}

async function listTotpFactors(uid) {
  const user = await auth.getUser(uid);
  const enrolled = user.multiFactor?.enrolledFactors || [];
  return enrolled.filter(isTotpFactor);
}

async function unenrollTotpFactors(uid) {
  const user = await auth.getUser(uid);
  const enrolled = user.multiFactor?.enrolledFactors || [];
  const remaining = enrolled.filter((factor) => !isTotpFactor(factor));
  if (remaining.length === enrolled.length) {
    return { unenrolled: false, remainingCount: remaining.length };
  }
  await auth.updateUser(uid, {
    multiFactor: { enrolledFactors: remaining }
  });
  return { unenrolled: true, remainingCount: remaining.length };
}

async function syncAuthenticatorEnabledFlag(uid, enabled) {
  const safeUid = String(uid || "").trim();
  if (!safeUid || /[.#$\[\]/]/.test(safeUid)) return;
  await db.ref(`${RTDB_USER_PATH}/${safeUid}/security`).update({
    authenticatorEnabled: enabled === true
  });
}

module.exports = {
  TOTP_FACTOR_ID,
  listTotpFactors,
  unenrollTotpFactors,
  syncAuthenticatorEnabledFlag
};
