<template>
  <div class="page">
    <h1 class="page-title">{{ t('home.title') }}</h1>
    <p class="page-subtitle">{{ t('home.subtitle') }}</p>

    <section class="section">
      <h2 class="section-title">{{ t('home.baseUrl') }}</h2>
      <CodeBlock :code="t('home.baseUrlValue')" lang="plaintext" />
    </section>

    <section class="section">
      <h2 class="section-title">{{ t('home.quickStart') }}</h2>
      <ol class="steps">
        <li>{{ t('home.quickStartSteps.1') }}</li>
        <li>{{ t('home.quickStartSteps.2') }}</li>
        <li>{{ t('home.quickStartSteps.3') }}</li>
      </ol>
      <div class="links">
        <router-link to="/session" class="doc-link">{{ t('nav.session') }} →</router-link>
        <router-link to="/chat" class="doc-link">{{ t('nav.chat') }} →</router-link>
        <router-link to="/messages" class="doc-link">{{ t('nav.messages') }} →</router-link>
        <router-link to="/chatbot" class="doc-link">{{ t('nav.chatbot') }} →</router-link>
      </div>
    </section>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import CodeBlock from '@/components/CodeBlock.vue'

const { t } = useI18n()
</script>

<style scoped>
.page-title { font-size: 2rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--text); }
.page-subtitle { color: var(--text-muted); font-size: 1.05rem; margin: 0 0 2rem; line-height: var(--doc-line-height); }
.section { margin-bottom: 2rem; }
.section-title { font-size: 1.25rem; margin: 0 0 0.75rem; color: var(--text); }
.steps { margin: 0 0 1rem; padding-left: 1.25rem; color: var(--text-dim); line-height: var(--doc-line-height); }
.links { display: flex; gap: 1rem; flex-wrap: wrap; }
.doc-link { color: var(--link); text-decoration: none; }
.doc-link:hover { text-decoration: underline; }
</style>
