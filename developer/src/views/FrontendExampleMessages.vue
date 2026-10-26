<template>
  <div class="page">
    <h1 class="page-title">{{ t('feMessages.title') }}</h1>
    <p class="page-desc">{{ t('feMessages.description') }}</p>
    <section class="section">
      <h2 class="section-title">{{ t('feMessages.callTitle') }}</h2>
      <p class="muted">{{ t('feMessages.callDesc') }}</p>
      <CodeBlock :code="callExample" lang="javascript" />
    </section>
    <section class="section">
      <h2 class="section-title">{{ t('feMessages.responseTitle') }}</h2>
      <p class="muted">{{ t('feMessages.responseDesc') }}</p>
      <CodeBlock :code="responseExample" lang="javascript" />
    </section>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import CodeBlock from '@/components/CodeBlock.vue'

const { t } = useI18n()

const callExample = `// POST /messages with Bearer token. Same token as for Chat API.
// conversation_id is optional; when omitted, the session token's cid is used.

const res = await fetch("https://api.frontierbase.io/messages", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + clientToken,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    plugin_key: "PLUGIN_KEY",
    // conversation_id: "CONVERSATION_ID",  // optional
  }),
});

if (!res.ok) {
  const err = await res.json().catch(() => ({}));
  throw new Error(err?.message || "HTTP " + res.status);
}

const json = await res.json();
const messages = json.data?.messages ?? [];`

const responseExample = `// json.data.messages: array of { id, role, content, created_at, locale }
// Ordered by created_at ascending (oldest first). Up to 500 most recent.

const messages = json.data?.messages ?? [];
messages.forEach((msg) => {
  console.log(msg.role, msg.content, new Date(msg.created_at));
});`
</script>

<style scoped>
.page-title { font-size: 2rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--text); }
.page-desc { color: var(--text-muted); margin: 0 0 2rem; line-height: var(--doc-line-height); }
.section { margin-bottom: 2rem; }
.section-title { font-size: 1.25rem; margin: 0 0 0.75rem; color: var(--text); }
.muted { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.5rem; }
</style>
