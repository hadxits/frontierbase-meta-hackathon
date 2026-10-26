const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { getDownloadURL } = require("firebase-admin/storage");
const { storage } = require("@/firebase");
const { logAndCaptureError } = require("@/utils/logger");

const DEFAULT_BUCKET =
  process.env.GCS_BUCKET || "frontierbase-console.firebasestorage.app";

/**
 * Google 프로필 CDN URL인지 여부.
 * @param {string} url
 * @returns {boolean}
 */
function isGoogleProfilePhotoUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return (
      host === "googleusercontent.com" ||
      host.endsWith(".googleusercontent.com")
    );
  } catch {
    return false;
  }
}

/**
 * @param {string | undefined} contentType
 * @returns {{ ext: string, contentType: string }}
 */
function extFromContentType(contentType) {
  const t = String(contentType || "").toLowerCase();
  if (t.includes("png")) return { ext: "png", contentType: "image/png" };
  if (t.includes("webp")) return { ext: "webp", contentType: "image/webp" };
  if (t.includes("gif")) return { ext: "gif", contentType: "image/gif" };
  return { ext: "jpg", contentType: "image/jpeg" };
}

/**
 * Google 프로필 이미지를 Storage `user/{uid}/`에 복사하고 Firebase download URL을 반환합니다.
 * Google URL이 아니거나 복사에 실패하면 원본 URL을 그대로 반환합니다.
 *
 * @param {string} uid
 * @param {string} photoURL
 * @param {{ tenant_id?: string }} [logCtx]
 * @returns {Promise<string>}
 */
async function persistGoogleProfilePhotoIfNeeded(uid, photoURL, logCtx = {}) {
  const src = String(photoURL || "").trim();
  if (!src || !isGoogleProfilePhotoUrl(src)) return src;

  try {
    const res = await axios.get(src, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FrontierBase/1.0)"
      },
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 300
    });

    const { ext, contentType } = extFromContentType(res.headers["content-type"]);
    // getDownloadURL은 파일에 download token이 있어야 하므로 업로드 시 함께 설정
    const token = uuidv4();
    const objectPath = `user/${uid}/avatar.${ext}`;
    const file = storage.bucket(DEFAULT_BUCKET).file(objectPath);

    await file.save(Buffer.from(res.data), {
      resumable: false,
      metadata: {
        contentType,
        cacheControl: "public,max-age=31536000",
        metadata: {
          firebaseStorageDownloadTokens: token
        }
      }
    });

    return await getDownloadURL(file);
  } catch (err) {
    logAndCaptureError(
      err,
      "[persistGoogleProfilePhoto] failed; keeping original photoURL",
      {
        tenant_id: logCtx.tenant_id || "system",
        function_name: "createUser",
        extra: { uid }
      }
    );
    return src;
  }
}

module.exports = {
  isGoogleProfilePhotoUrl,
  persistGoogleProfilePhotoIfNeeded
};