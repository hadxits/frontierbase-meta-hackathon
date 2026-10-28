const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { getDownloadURL } = require("firebase-admin/storage");
const { storage } = require("@/firebase");
const { logAndCaptureError } = require("@/utils/logger");

const DEFAULT_BUCKET =
  process.env.GCS_BUCKET || "frontierbase-console.firebasestorage.app";

/**
 * Check if URL is Google profile CDN URL.
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
 * Copy Google profile image to Storage `user/{uid}/` and return Firebase download URL.
 * Return original URL if not Google URL or copy fails.
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
    // getDownloadURL requires download token on file, so set it during upload.
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