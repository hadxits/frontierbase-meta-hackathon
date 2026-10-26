const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");

function normalizeMemberValue(value) {
  return String(value || "").trim().toLowerCase();
}

function isActiveMemberStatus(status) {
  return normalizeMemberValue(status) === "active";
}

async function loadTenantMember(tenantId, uid) {
  if (!tenantId || !uid) {
    return {
      exists: false,
      data: null,
      role: "",
      status: "",
      isActive: false
    };
  }

  const memberSnap = await store
    .collection(Collection.TENANTS)
    .doc(String(tenantId))
    .collection(Collection.MEMBERS)
    .doc(String(uid))
    .get();
  const data = memberSnap.data();
  const role = normalizeMemberValue(data?.role);
  const status = normalizeMemberValue(data?.status);

  return {
    exists: memberSnap.exists,
    data: data || null,
    role,
    status,
    isActive: memberSnap.exists && status === "active"
  };
}

module.exports = {
  isActiveMemberStatus,
  loadTenantMember
};
