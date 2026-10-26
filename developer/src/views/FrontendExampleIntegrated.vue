<template>
  <div class="page">
    <h1 class="page-title">{{ t('feIntegrated.title') }}</h1>
    <p class="page-desc">{{ t('feIntegrated.description') }}</p>
    <section class="section">
      <h2 class="section-title">{{ t('feIntegrated.frontendTitle') }}</h2>
      <p class="muted">{{ t('feIntegrated.frontendDesc') }}</p>
      <CodeBlock :code="frontendExampleCode" lang="javascript" />
    </section>
    <section class="section">
      <h2 class="section-title">{{ t('feIntegrated.backendTitle') }}</h2>
      <p class="muted">{{ t('feIntegrated.backendDesc') }}</p>
      <CodeBlock :code="backendExampleCode" lang="javascript" />
    </section>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import CodeBlock from '@/components/CodeBlock.vue'

const { t } = useI18n()

const frontendExampleCode = `const CHAT_API_URL = "https://api.frontierbase.io";
const YOUR_BACKEND_TOKEN_URL = "https://your-backend.com/api/chat-token";
let clientToken = null;
let expiresAt = 0;

async function getTokenFromBackend() {
  const res = await fetch(YOUR_BACKEND_TOKEN_URL);
  if (!res.ok) throw new Error("Failed to get token");
  const data = await res.json();
  clientToken = data.client_token;
  expiresAt = data.expires_at;
  return clientToken;
}

async function ensureToken() {
  const nowSec = Date.now() / 1000;
  const bufferSec = 30;
  if (!clientToken || expiresAt - nowSec < bufferSec) {
    await getTokenFromBackend();
  }
  return clientToken;
}

// Optional: pass AbortSignal to cancel (e.g. user clicks "Stop"). See Chat example for SSE parsing.
async function callStream(message, signal) {
  let token = await ensureToken();
  let res = await fetch(CHAT_API_URL + "/chat", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      plugin_key: "PLUGIN_KEY",
      message: message,
      locale: "en",
      dataset_ids: ["purpose-a", "purpose-b"],  // optional: RAG search target dataset IDs
    }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err?.error?.code === "FB_101") {
      await getTokenFromBackend();
      res = await fetch(CHAT_API_URL + "/chat", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + clientToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          plugin_key: "PLUGIN_KEY",
          message: message,
          locale: "en",
          dataset_ids: ["purpose-a", "purpose-b"],  // optional: RAG search target dataset IDs
        }),
        signal,
      });
    }
  }
  return res;
  // Then read SSE with readChatStream(res, { onStatus, onDelta, onDone, onError, signal }) — see Chat example.`

const backendExampleCode = `// Your backend: call Session API and return client_token to the frontend.
const BASE_URL = "https://api.frontierbase.io";
const SERVER_API_SECRET = process.env.FRONTIERBASE_SERVER_API_SECRET;

async function getChatToken(req, res) {
  const sessionRes = await fetch(BASE_URL + "/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + SERVER_API_SECRET,
    },
    body: JSON.stringify({
      user_id: req.user?.id || "anonymous",
      project_id: req.query.project_id || "default",
    }),
  });
  if (!sessionRes.ok) {
    return res.status(502).json({ error: "Session failed" });
  }
  const json = await sessionRes.json();
  const data = json.data || json;
  res.json({
    client_token: data.client_token,
    expires_at: data.expires_at,
    plugin_key: data.plugin_key,
  });
}`
</script>

<style scoped>
.page-title { font-size: 2rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--text); }
.page-desc { color: var(--text-muted); margin: 0 0 2rem; line-height: var(--doc-line-height); }
.section { margin-bottom: 2rem; }
.section-title { font-size: 1.25rem; margin: 0 0 0.75rem; color: var(--text); }
.muted { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.5rem; }
</style>
