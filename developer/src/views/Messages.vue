<template>
  <div class="page">
    <h1 class="page-title">{{ t('messages.title') }}</h1>
    <p class="page-desc">{{ t('messages.description') }}</p>

    <section class="section">
      <h2 class="section-title">{{ t('messages.endpoint') }}</h2>
      <p><strong>{{ t('messages.method') }}:</strong> {{ t('messages.post') }}</p>
      <p><strong>{{ t('messages.path') }}:</strong> <code>{{ t('messages.pathValue') }}</code></p>
      <CodeBlock code="POST https://api.frontierbase.io/messages" lang="plaintext" />
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('messages.headers') }}</h2>
      <p class="muted">{{ t('messages.headersDesc') }}</p>
      <CodeBlock :code="t('messages.authHeader')" lang="plaintext" />
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('messages.requestBody') }}</h2>
      <p class="muted">{{ t('messages.requestBodyDesc') }}</p>
      <table class="params-table">
        <thead>
          <tr>
            <th>{{ t('messages.requestBodyTableField') }}</th>
            <th>{{ t('messages.requestBodyTableType') }}</th>
            <th>{{ t('messages.requestBodyTableRequired') }}</th>
            <th>{{ t('messages.requestBodyTableDesc') }}</th>
            <th>{{ t('messages.requestBodyTableDefault') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>plugin_key</code></td>
            <td>{{ t('messages.bodyFields.plugin_key.type') }}</td>
            <td>{{ t('messages.bodyFields.plugin_key.required') }}</td>
            <td>{{ t('messages.bodyFields.plugin_key.desc') }}</td>
            <td>{{ t('messages.bodyFields.plugin_key.default') }}</td>
          </tr>
          <tr>
            <td><code>conversation_id</code></td>
            <td>{{ t('messages.bodyFields.conversation_id.type') }}</td>
            <td>{{ t('messages.bodyFields.conversation_id.required') }}</td>
            <td>{{ t('messages.bodyFields.conversation_id.desc') }}</td>
            <td>{{ t('messages.bodyFields.conversation_id.default') }}</td>
          </tr>
        </tbody>
      </table>
      <CodeBlock :code="bodyExample" lang="json" />
      <p class="muted note">{{ t('messages.pluginKeyWhereToFind') }}</p>
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('messages.response') }}</h2>
      <p class="muted">{{ t('messages.responseDesc') }}</p>
      <table class="params-table">
        <thead>
          <tr>
            <th>{{ t('messages.responseTableField') }}</th>
            <th>{{ t('messages.responseTableType') }}</th>
            <th>{{ t('messages.responseTableDesc') }}</th>
            <th>{{ t('messages.responseTableExample') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>messages</code></td>
            <td>{{ t('messages.responseRows.messages.type') }}</td>
            <td>{{ t('messages.responseRows.messages.desc') }}</td>
            <td><code>{{ t('messages.responseRows.messages.example') }}</code></td>
          </tr>
          <tr>
            <td><code>id</code></td>
            <td>{{ t('messages.responseRows.id.type') }}</td>
            <td>{{ t('messages.responseRows.id.desc') }}</td>
            <td><code>{{ t('messages.responseRows.id.example') }}</code></td>
          </tr>
          <tr>
            <td><code>role</code></td>
            <td>{{ t('messages.responseRows.role.type') }}</td>
            <td>{{ t('messages.responseRows.role.desc') }}</td>
            <td><code>{{ t('messages.responseRows.role.example') }}</code></td>
          </tr>
          <tr>
            <td><code>content</code></td>
            <td>{{ t('messages.responseRows.content.type') }}</td>
            <td>{{ t('messages.responseRows.content.desc') }}</td>
            <td><code>{{ t('messages.responseRows.content.example') }}</code></td>
          </tr>
          <tr>
            <td><code>created_at</code></td>
            <td>{{ t('messages.responseRows.created_at.type') }}</td>
            <td>{{ t('messages.responseRows.created_at.desc') }}</td>
            <td><code>{{ t('messages.responseRows.created_at.example') }}</code></td>
          </tr>
          <tr>
            <td><code>locale</code></td>
            <td>{{ t('messages.responseRows.locale.type') }}</td>
            <td>{{ t('messages.responseRows.locale.desc') }}</td>
            <td><code>{{ t('messages.responseRows.locale.example') }}</code></td>
          </tr>
        </tbody>
      </table>
      <CodeBlock :code="responseExample" lang="json" />
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('messages.errors') }}</h2>
      <table class="errors-table">
        <thead>
          <tr>
            <th>{{ t('messages.errorsTableCode') }}</th>
            <th>{{ t('messages.errorsTableDesc') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="code in errorCodes" :key="code">
            <td><code>{{ code }}</code></td>
            <td>{{ t('messages.errorsList.' + code) }}</td>
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

const bodyExample = `{
  "plugin_key": "PLUGIN_KEY"
}`

const responseExample = `{
  "status": "success",
  "message": "Request successful",
  "data": {
    "messages": [
      {
        "id": "msg_abc123",
        "role": "user",
        "content": "Hello",
        "created_at": 1736723400000,
        "locale": "en"
      },
      {
        "id": "msg_def456",
        "role": "assistant",
        "content": "Hi, how can I help?",
        "created_at": 1736723401000,
        "locale": null
      }
    ]
  }
}`
</script>

<style scoped>
.page-title { font-size: 2rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--text); }
.page-desc { color: var(--text-muted); margin: 0 0 2rem; line-height: var(--doc-line-height); }
.section { margin-bottom: 2rem; }
.section-title { font-size: 1.25rem; margin: 0 0 0.75rem; color: var(--text); }
.muted { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.5rem; }
.note { color: var(--link); font-size: 0.9rem; margin-bottom: 1rem; padding: 0.5rem 0.75rem; background: var(--code-bg); border-radius: 6px; border-left: 3px solid var(--link); }
.params-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 0.5rem 0; }
.params-table th, .params-table td { padding: 0.5rem 0.75rem; text-align: left; border: 1px solid var(--border); }
.params-table th { background: var(--sidebar-bg); font-weight: 600; color: var(--text); }
.params-table td { color: var(--text-dim); }
.params-table code { color: var(--code-text); }
.errors-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 0.5rem 0; }
.errors-table th, .errors-table td { padding: 0.5rem 0.75rem; text-align: left; border: 1px solid var(--border); }
.errors-table th { background: var(--sidebar-bg); font-weight: 600; color: var(--text); }
.errors-table td { color: var(--text-dim); }
.errors-table code { color: var(--code-error); }
</style>
