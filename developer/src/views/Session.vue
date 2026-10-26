<template>
  <div class="page">
    <h1 class="page-title">{{ t('session.title') }}</h1>
    <p class="page-desc">{{ t('session.description') }}</p>

    <div class="callout callout-warning">
      <strong>{{ t('session.backendOnlyTitle') }}</strong> {{ t('session.backendOnlyDesc') }}
    </div>
    <div class="callout callout-warning">
      <strong>{{ t('session.secretRequiredTitle') }}</strong> {{ t('session.secretRequiredDesc') }}
    </div>

    <section class="section">
      <h2 class="section-title">{{ t('session.endpoint') }}</h2>
      <p><strong>{{ t('session.method') }}:</strong> {{ t('session.post') }}</p>
      <p><strong>{{ t('session.path') }}:</strong> <code>{{ t('session.pathValue') }}</code></p>
      <CodeBlock code="POST https://api.frontierbase.io/session" lang="plaintext" />
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('session.headers') }}</h2>
      <p class="muted">{{ t('session.headersDesc') }}</p>
      <CodeBlock :code="t('session.authHeader')" lang="plaintext" />
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('session.requestBody') }}</h2>
      <p class="muted">{{ t('session.requestBodyDesc') }}</p>
      <table class="params-table">
        <thead>
          <tr>
            <th>{{ t('session.requestBodyTableField') }}</th>
            <th>{{ t('session.requestBodyTableType') }}</th>
            <th>{{ t('session.requestBodyTableRequired') }}</th>
            <th>{{ t('session.requestBodyTableDesc') }}</th>
            <th>{{ t('session.requestBodyTableDefault') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>user_id</code></td>
            <td>{{ t('session.bodyFields.user_id.type') }}</td>
            <td>{{ t('session.bodyFields.user_id.required') }}</td>
            <td>{{ t('session.bodyFields.user_id.desc') }}</td>
            <td><code>{{ t('session.bodyFields.user_id.default') }}</code></td>
          </tr>
          <tr>
            <td><code>project_id</code></td>
            <td>{{ t('session.bodyFields.project_id.type') }}</td>
            <td>{{ t('session.bodyFields.project_id.required') }}</td>
            <td>{{ t('session.bodyFields.project_id.desc') }}</td>
            <td><code>{{ t('session.bodyFields.project_id.default') }}</code></td>
          </tr>
        </tbody>
      </table>
      <CodeBlock :code="sessionExample" lang="json" />
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('session.response') }}</h2>
      <p class="muted">{{ t('session.responseDesc') }}</p>
      <table class="params-table">
        <thead>
          <tr>
            <th>{{ t('session.responseTableField') }}</th>
            <th>{{ t('session.responseTableType') }}</th>
            <th>{{ t('session.responseTableDesc') }}</th>
            <th>{{ t('session.responseTableExample') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>client_token</code></td>
            <td>{{ t('session.responseRows.client_token.type') }}</td>
            <td>{{ t('session.responseRows.client_token.desc') }}</td>
            <td><code>{{ t('session.responseRows.client_token.example') }}</code></td>
          </tr>
          <tr>
            <td><code>token_type</code></td>
            <td>{{ t('session.responseRows.token_type.type') }}</td>
            <td>{{ t('session.responseRows.token_type.desc') }}</td>
            <td><code>{{ t('session.responseRows.token_type.example') }}</code></td>
          </tr>
          <tr>
            <td><code>expires_in</code></td>
            <td>{{ t('session.responseRows.expires_in.type') }}</td>
            <td>{{ t('session.responseRows.expires_in.desc') }}</td>
            <td><code>{{ t('session.responseRows.expires_in.example') }}</code></td>
          </tr>
          <tr>
            <td><code>expires_at</code></td>
            <td>{{ t('session.responseRows.expires_at.type') }}</td>
            <td>{{ t('session.responseRows.expires_at.desc') }}</td>
            <td><code>{{ t('session.responseRows.expires_at.example') }}</code></td>
          </tr>
          <tr>
            <td><code>conversation_id</code></td>
            <td>{{ t('session.responseRows.conversation_id.type') }}</td>
            <td>{{ t('session.responseRows.conversation_id.desc') }}</td>
            <td><code>{{ t('session.responseRows.conversation_id.example') }}</code></td>
          </tr>
          <tr>
            <td><code>plugin_key</code></td>
            <td>{{ t('session.responseRows.plugin_key.type') }}</td>
            <td>{{ t('session.responseRows.plugin_key.desc') }}</td>
            <td><code>{{ t('session.responseRows.plugin_key.example') }}</code></td>
          </tr>
        </tbody>
      </table>
      <CodeBlock :code="responseExample" lang="json" />
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('session.errors') }}</h2>
      <table class="params-table">
        <thead>
          <tr>
            <th>{{ t('session.errorsTableCode') }}</th>
            <th>{{ t('session.errorsTableDesc') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(desc, code) in sessionErrors" :key="code">
            <td><code>{{ code }}</code></td>
            <td>{{ desc }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import CodeBlock from '@/components/CodeBlock.vue'

const { t, tm } = useI18n()

const sessionExample = `{
  "user_id": "USER_ID",
  "project_id": "PROJECT_ID"
}`

const responseExample = `{
  "status": "success",
  "message": "Request successful",
  "data": {
    "client_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer",
    "expires_in": 300,
    "expires_at": 1736723400,
    "conversation_id": "a1b2c3d4e5f6789012345678abcdef01",
    "plugin_key": "PLUGIN_KEY"
  }
}`

const sessionErrors = computed(() => tm('session.errorsList') || {})
</script>

<style scoped>
.page-title { font-size: 2rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--text); }
.page-desc { color: var(--text-muted); margin: 0 0 2rem; line-height: var(--doc-line-height); }
.section { margin-bottom: 2rem; }
.section-title { font-size: 1.25rem; margin: 0 0 0.75rem; color: var(--text); }
.muted { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.5rem; }
.params { margin: 0.5rem 0 1rem; padding-left: 1.25rem; color: var(--text-dim); line-height: var(--doc-line-height); }
.params code { color: var(--code-text); }
.params-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 0.5rem 0; }
.params-table th, .params-table td { padding: 0.5rem 0.75rem; text-align: left; border: 1px solid var(--border); }
.params-table th { background: var(--sidebar-bg); font-weight: 600; color: var(--text); }
.params-table td { color: var(--text-dim); }
.params-table code { color: var(--code-text); }
.callout { padding: 1rem 1.25rem; border-radius: 8px; margin: 0 0 1.5rem; border-left: 4px solid; background: var(--code-bg); }
.callout-warning { border-left-color: #cf222e; }
</style>
