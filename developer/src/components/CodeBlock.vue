<template>
  <div class="code-block" :class="{ 'code-block--header': label }">
    <div v-if="label" class="code-block-header">{{ label }}</div>
    <pre class="code-pre"><code class="hljs" v-html="highlighted"></code></pre>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)

const props = defineProps({
  code: { type: String, required: true },
  lang: { type: String, default: 'javascript' },
  label: { type: String, default: '' },
})

const highlighted = computed(() => {
  const { code, lang } = props
  if (!code) return ''
  try {
    if (lang === 'plaintext' || lang === 'text') {
      return escapeHtml(code)
    }
    return hljs.highlight(code, { language: lang }).value
  } catch {
    return escapeHtml(code)
  }
})

function escapeHtml (text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
</script>

<style scoped>
.code-block {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  margin: 0.75rem 0;
}
.code-block--header .code-pre {
  border-radius: 0;
}
.code-block-header {
  padding: 0.35rem 1rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  background: var(--sidebar-bg);
  border-bottom: 1px solid var(--border);
}
.code-pre {
  margin: 0;
  padding: 1rem 1.25rem;
  font-size: 0.85rem;
  line-height: var(--doc-line-height);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
}
.code-pre :deep(.hljs) {
  padding: 0;
  background: transparent;
}
</style>
