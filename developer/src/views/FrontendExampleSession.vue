<template>
  <div class="page">
    <h1 class="page-title">{{ t('feSession.title') }}</h1>
    <p class="page-desc">{{ t('feSession.description') }}</p>
    <div class="callout callout-warning">
      <strong>{{ t('feSession.backendOnly') }}</strong> {{ t('feSession.backendOnlyDesc') }}
    </div>
    <section class="section">
      <h2 class="section-title">{{ t('feSession.exampleTitle') }}</h2>
      <p class="muted">{{ t('feSession.exampleDesc') }}</p>
      <CodeBlock :code="backendExampleCode" lang="javascript" />
    </section>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import CodeBlock from '@/components/CodeBlock.vue'

const { t } = useI18n()

const backendExampleCode = `// Your backend: call Session API and return client_token to the frontend.
// Example (Node.js). Never call Session API from the browser.
// Create a Server API Secret in Console > Development > API Key Management.

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
.callout { padding: 1rem 1.25rem; border-radius: 8px; margin: 0 0 1.5rem; border-left: 4px solid; background: var(--code-bg); }
.callout-warning { border-left-color: #cf222e; }
</style>
