<template>
  <div class="page">
    <h1 class="page-title">{{ t('chat.title') }}</h1>
    <p class="page-desc">{{ t('chat.description') }}</p>
    <div class="callout callout-warning pre-line">{{ t('chat.freePlanTip') }}</div>

    <section class="section">
      <h2 class="section-title">{{ t('chat.endpoint') }}</h2>
      <p><strong>{{ t('chat.method') }}:</strong> {{ t('chat.post') }}</p>
      <p><strong>{{ t('chat.path') }}:</strong> <code>{{ t('chat.pathValue') }}</code></p>
      <CodeBlock code="POST https://api.frontierbase.io/chat" lang="plaintext" />
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('chat.headers') }}</h2>
      <p class="muted">{{ t('chat.headersDesc') }}</p>
      <CodeBlock :code="t('chat.authHeader')" lang="plaintext" />
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('chat.requestBody') }}</h2>
      <p class="muted">{{ t('chat.requestBodyDesc') }}</p>
      <table class="params-table">
        <thead>
          <tr>
            <th>{{ t('chat.requestBodyTableField') }}</th>
            <th>{{ t('chat.requestBodyTableType') }}</th>
            <th>{{ t('chat.requestBodyTableRequired') }}</th>
            <th>{{ t('chat.requestBodyTableDesc') }}</th>
            <th>{{ t('chat.requestBodyTableDefault') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>plugin_key</code></td>
            <td>{{ t('chat.bodyFields.plugin_key.type') }}</td>
            <td>{{ t('chat.bodyFields.plugin_key.required') }}</td>
            <td>{{ t('chat.bodyFields.plugin_key.desc') }}</td>
            <td>{{ t('chat.bodyFields.plugin_key.default') }}</td>
          </tr>
          <tr>
            <td><code>email</code></td>
            <td>{{ t('chat.bodyFields.email.type') }}</td>
            <td>{{ t('chat.bodyFields.email.required') }}</td>
            <td>{{ t('chat.bodyFields.email.desc') }}</td>
            <td>{{ t('chat.bodyFields.email.default') }}</td>
          </tr>
          <tr>
            <td><code>message</code></td>
            <td>{{ t('chat.bodyFields.message.type') }}</td>
            <td>{{ t('chat.bodyFields.message.required') }}</td>
            <td>{{ t('chat.bodyFields.message.desc') }}</td>
            <td>{{ t('chat.bodyFields.message.default') }}</td>
          </tr>
          <tr>
            <td><code>locale</code></td>
            <td>{{ t('chat.bodyFields.locale.type') }}</td>
            <td>{{ t('chat.bodyFields.locale.required') }}</td>
            <td>{{ t('chat.bodyFields.locale.desc') }}</td>
            <td><code>{{ t('chat.bodyFields.locale.default') }}</code></td>
          </tr>
          <tr>
            <td><code>dataset_ids</code></td>
            <td>{{ t('chat.bodyFields.dataset_ids.type') }}</td>
            <td>{{ t('chat.bodyFields.dataset_ids.required') }}</td>
            <td>{{ t('chat.bodyFields.dataset_ids.desc') }}</td>
            <td>{{ t('chat.bodyFields.dataset_ids.default') }}</td>
          </tr>
        </tbody>
      </table>
      <CodeBlock :code="bodyExample" lang="json" />
      <p class="muted note">{{ t('messages.pluginKeyWhereToFind') }}</p>
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('chat.streaming') }}</h2>
      <p class="muted">{{ t('chat.streamingDesc') }}</p>
      <h3 class="subsection-title">{{ t('chat.statusTypesTitle') }}</h3>
      <table class="params-table">
        <thead>
          <tr>
            <th>{{ t('chat.statusTableKey') }}</th>
            <th>{{ t('chat.statusTableDesc') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="key in statusKeys" :key="key">
            <td><code>{{ key }}</code></td>
            <td>{{ t('chat.statusTypes.' + key) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('chat.response') }}</h2>
      <p class="muted">{{ t('chat.responseDesc') }}</p>
      <table class="params-table">
        <thead>
          <tr>
            <th>{{ t('chat.responseTableField') }}</th>
            <th>{{ t('chat.responseTableType') }}</th>
            <th>{{ t('chat.responseTableDesc') }}</th>
            <th>{{ t('chat.responseTableExample') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>status</code></td>
            <td>{{ t('chat.responseRows.status.type') }}</td>
            <td>{{ t('chat.responseRows.status.desc') }}</td>
            <td><code>{{ t('chat.responseRows.status.example') }}</code></td>
          </tr>
          <tr>
            <td><code>delta</code></td>
            <td>{{ t('chat.responseRows.delta.type') }}</td>
            <td>{{ t('chat.responseRows.delta.desc') }}</td>
            <td><code>{{ t('chat.responseRows.delta.example') }}</code></td>
          </tr>
          <tr>
            <td><code>error</code></td>
            <td>{{ t('chat.responseRows.error.type') }}</td>
            <td>{{ t('chat.responseRows.error.desc') }}</td>
            <td><code>{{ t('chat.responseRows.error.example') }}</code></td>
          </tr>
        </tbody>
      </table>
      <CodeBlock :code="responseExample" lang="plaintext" />
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('chat.errors') }}</h2>
      <table class="errors-table">
        <thead>
          <tr>
            <th>{{ t('chat.errorsTableCode') }}</th>
            <th>{{ t('chat.errorsTableDesc') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="code in errorCodes" :key="code">
            <td><code>{{ code }}</code></td>
            <td>{{ t('chat.errorsList.' + code) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import CodeBlock from '@/components/CodeBlock.vue'

const { t } = useI18n()

const errorCodes = [
  'FB_100', 'FB_101', 'FB_102', 'FB_103', 'FB_105',
  'FB_200', 'FB_201',
  'FB_300', 'FB_301',
  'FB_302',
  'FB_500', 'FB_501'
]

const statusKeys = [
  'loading_tenant',
  'loading_data',
  'vector_search',
  'analyzing_question',
  'optimizing_search',
  'searching_again',
  'loading_sources',
  'checking_sufficiency',
  'searching_additional',
  'loading_expanded_sources',
  'reusing_cache',
  'calling_model',
  'generating_response',
  'processing'
]

const bodyExample = `{
  "plugin_key": "PLUGIN_KEY",
  "email": "user@example.com",
  "message": "Hello, I have a question.",
  "locale": "en"
}`

const responseExample = `event: status
data: {"text":"Searching..."}

event: delta
data: {"text":"Hello "}

event: delta
data: {"text":"world."}

event: error
data: {"message":"Token expired","errorCode":"FB_101"}`
</script>

<style scoped>
.page-title { font-size: 2rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--text); }
.page-desc { color: var(--text-muted); margin: 0 0 2rem; line-height: var(--doc-line-height); }
.section { margin-bottom: 2rem; }
.section-title { font-size: 1.25rem; margin: 0 0 0.75rem; color: var(--text); }
.subsection-title { font-size: 1rem; margin: 1.25rem 0 0.5rem; color: var(--text); font-weight: 600; }
.muted { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.5rem; }
.params { margin: 0.5rem 0 1rem; padding-left: 1.25rem; color: var(--text-dim); line-height: var(--doc-line-height); }
.params code { color: var(--code-text); }
.note { color: var(--link); font-size: 0.9rem; margin-bottom: 1rem; padding: 0.5rem 0.75rem; background: var(--code-bg); border-radius: 6px; border-left: 3px solid var(--link); white-space: pre-line; }
.errors-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 0.5rem 0; }
.errors-table th, .errors-table td { padding: 0.5rem 0.75rem; text-align: left; border: 1px solid var(--border); }
.errors-table th { background: var(--sidebar-bg); font-weight: 600; color: var(--text); }
.errors-table td { color: var(--text-dim); }
.errors-table code { color: var(--code-error); }
.params-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 0.5rem 0; }
.params-table th, .params-table td { padding: 0.5rem 0.75rem; text-align: left; border: 1px solid var(--border); }
.params-table th { background: var(--sidebar-bg); font-weight: 600; color: var(--text); }
.params-table td { color: var(--text-dim); }
.params-table code { color: var(--code-text); }
.callout { padding: 1rem 1.25rem; border-radius: 8px; margin: 0 0 1.5rem; border-left: 4px solid; background: var(--code-bg); }
.callout-warning { border-left-color: #cf222e; }
.pre-line { white-space: pre-line; }
</style>
