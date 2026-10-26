const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const { Storage } = require("@google-cloud/storage");

const developServiceAccountKey = require("@/store.json");
const productionServiceAccountKey = require("@/store.json");

const environment = require("@/env");
const profile = environment.PROFILE;
const DATABASE_URL = environment.DATABASE_URL;

const initApp = () => {
  const serviceAccountKey =
    profile === "develop"
      ? developServiceAccountKey
      : productionServiceAccountKey;

  const app = initializeApp({
    credential: cert(serviceAccountKey),
    databaseURL: DATABASE_URL
  });

  const auth = getAuth(app);

  const messaging = getMessaging();

  const store = getFirestore(app);

  const db = getDatabase(app);

  // 서비스 계정 키로 초기화하여 getSignedUrl 시 IAM signBlob 대신 키 파일로 로컬 서명
  const storage = new Storage({
    projectId: serviceAccountKey.project_id,
    credentials: {
      client_email: serviceAccountKey.client_email,
      private_key: serviceAccountKey.private_key
    }
  });

  return { auth, store, db, messaging, storage };
};

const { auth, store, db, messaging, storage } = initApp();

module.exports = { auth, store, db, messaging, storage };