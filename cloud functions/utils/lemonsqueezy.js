const crypto = require("crypto");
const axios = require("axios");
const environment = require("@/env");

/**
 * Lemon Squeezy variant mapping (provided by user).
 * NOTE: "STATER" in the input is treated as STARTER plan.
 */
const VARIANTS = {
  // Subscriptions (운영 계정)
  1307428: { kind: "subscription", plan: "STARTER", interval: "month" },
  1307429: { kind: "subscription", plan: "STARTER", interval: "year" },
  1307434: { kind: "subscription", plan: "PRO", interval: "month" },
  1307435: { kind: "subscription", plan: "PRO", interval: "year" },
  1307438: { kind: "subscription", plan: "ENTERPRISE", interval: "month" },

  // Token packs (one-time)
  1307452: { kind: "token_pack", pack: "S", tokens: 10_000_000 },
  1307453: { kind: "token_pack", pack: "M", tokens: 100_000_000 },
  1307454: { kind: "token_pack", pack: "L", tokens: 1_000_000_000 },

  // Subscriptions (Test 계정)
  // 1309472: { kind: "subscription", plan: "STARTER", interval: "month" },
  // 1309475: { kind: "subscription", plan: "STARTER", interval: "year" },
  // 1337743: { kind: "subscription", plan: "PRO", interval: "month" },
  // 1337755: { kind: "subscription", plan: "PRO", interval: "year" },
  // 1337780: { kind: "subscription", plan: "ENTERPRISE", interval: "month" },
  //
  // // Token packs (one-time)
  // 1337763: { kind: "token_pack", pack: "S", tokens: 10_000_000 },
  // 1337774: { kind: "token_pack", pack: "M", tokens: 100_000_000 },
  // 1337775: { kind: "token_pack", pack: "L", tokens: 1_000_000_000 }
};

function getVariantInfo(variantId) {
  const id = Number(variantId);
  return VARIANTS[id] ? { variant_id: id, ...VARIANTS[id] } : null;
}

function lemonClient() {
  const apiKey = environment.LEMON_SQUEEZY_API_KEY;
  if (!apiKey) {
    throw new Error("LEMON_SQUEEZY_API_KEY is required");
  }
  return axios.create({
    baseURL: "https://api.lemonsqueezy.com/v1",
    timeout: 15_000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
  });
}

/**
 * Verify Lemon Squeezy webhook request signature.
 *
 * Signing secret is configured when creating the webhook.
 * Lemon Squeezy sends an HMAC hex digest of the raw body in X-Signature.
 *
 * @param {import("express").Request} req
 * @returns {boolean}
 */
function verifyWebhookSignature(req) {
  const secret = environment.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    // If not configured, treat as invalid (secure by default).
    return false;
  }
  const raw = req.rawBody;
  if (!raw || !(raw instanceof Buffer)) {
    return false;
  }
  const signature = Buffer.from(String(req.get("X-Signature") || ""), "utf8");
  const digest = Buffer.from(
    crypto.createHmac("sha256", secret).update(raw).digest("hex"),
    "utf8"
  );

  // Same length required for timingSafeEqual.
  if (digest.length !== signature.length) return false;
  return crypto.timingSafeEqual(digest, signature);
}

/**
 * Extract tenant id from webhook payload (custom_data).
 * We support tenant_id, tenantId, tenant. Returns string for Firestore doc id, or null.
 */
function getTenantIdFromWebhook(body) {
  const custom = body && body.meta && body.meta.custom_data;
  if (!custom || typeof custom !== "object") return null;
  const raw = custom.tenant_id ?? custom.tenantId ?? custom.tenant;
  return raw != null ? String(raw) : null;
}

function parseIsoToMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(String(iso));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Map Lemon subscription status to our status enum.
 * Our enum: active | past_due | canceled | trialing
 */
function mapSubscriptionStatus(lsStatus) {
  const s = String(lsStatus || "").toLowerCase();
  if (s === "on_trial") return "trialing";
  if (s === "active") return "active";
  if (s === "past_due") return "past_due";
  if (s === "paused") return "past_due";
  if (s === "cancelled" || s === "canceled") return "canceled";
  if (s === "expired") return "canceled";
  // Fallback: treat unknown as active to avoid accidental downgrades
  return "active";
}

module.exports = {
  getVariantInfo,
  lemonClient,
  verifyWebhookSignature,
  getTenantIdFromWebhook,
  parseIsoToMs,
  mapSubscriptionStatus,
};