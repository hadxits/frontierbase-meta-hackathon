const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { store } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const { logger } = require("firebase-functions/v2");
const { v4: uuid } = require("uuid");
const { Timestamp } = require("firebase-admin/firestore");
const expiresInDays = 180;

const saveTenantHistory = onDocumentWritten(
  {
    document: "tenant/{tenantId}",
    cpu: "gcf_gen1"
  },
  async (event) => {
    const tenant = event.data.after.data();
    if (!tenant) {
      return;
    }
    logger.debug(
      `[사용자 이력 저장]\nname = ${tenant.name}\nplan = ${tenant.plan}\nstatus = ${tenant.status}\nlanguage = ${tenant.language}\n`
    );
    try {
      tenant["expiresTimeStamp"] = Timestamp.fromDate(
        new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      );
      tenant.added_at = Date.now();
      await store.collection(Collection.TENANTS_HISTORY).add(tenant);
    } catch (e) {
      // notificationService.notifyError({
      //   id: uuid(),
      //   functionName: 'event.saveOrderHistory',
      //   errorMessage: `Failed to save customer history. Reason: ${e.message}`,
      //   timeStamp: getServerTimestamp(),
      // });
    }
  }
);

module.exports = saveTenantHistory;