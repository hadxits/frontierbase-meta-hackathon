<template>
  <div class="page">
    <h1 class="page-title">{{ t('frontendExample.title') }}</h1>
    <p class="page-desc">{{ t('frontendExample.description') }}</p>
    <section class="section">
      <h2 class="section-title">{{ t('frontendExample.overviewTitle') }}</h2>
      <p class="muted">{{ t('frontendExample.overviewDesc') }}</p>
      <ul class="example-links">
        <li>
          <router-link to="/frontend-example/session" class="doc-link">{{ t('frontendExample.overviewSession') }} →</router-link>
          <span class="muted-inline">{{ t('frontendExample.overviewSessionDesc') }}</span>
        </li>
        <li>
          <router-link to="/frontend-example/chat" class="doc-link">{{ t('frontendExample.overviewChat') }} →</router-link>
          <span class="muted-inline">{{ t('frontendExample.overviewChatDesc') }}</span>
        </li>
        <li>
          <router-link to="/frontend-example/messages" class="doc-link">{{ t('frontendExample.overviewMessages') }} →</router-link>
          <span class="muted-inline">{{ t('frontendExample.overviewMessagesDesc') }}</span>
        </li>
        <li>
          <router-link to="/frontend-example/integrated" class="doc-link">{{ t('frontendExample.overviewIntegrated') }} →</router-link>
          <span class="muted-inline">{{ t('frontendExample.overviewIntegratedDesc') }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<style scoped>
.page-title { font-size: 2rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--text); }
.page-desc { color: var(--text-muted); margin: 0 0 2rem; line-height: var(--doc-line-height); }
.section { margin-bottom: 2rem; }
.section-title { font-size: 1.25rem; margin: 0 0 0.75rem; color: var(--text); }
.muted { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.75rem; }
.example-links { list-style: none; padding: 0; margin: 0; }
.example-links li { margin-bottom: 1rem; }
.doc-link { color: var(--link); font-weight: 500; }
.muted-inline { color: var(--text-muted); font-size: 0.9rem; margin-left: 0.35rem; }
</style>
