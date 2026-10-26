<template>
  <div class="not-found page">
    <h1 class="page-title">{{ t('notFound.title') }}</h1>
    <p class="page-subtitle">{{ t('notFound.description') }}</p>
    <router-link to="/" class="doc-link">{{ t('notFound.backHome') }}</router-link>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<style scoped>
.not-found {
  padding-top: 2rem;
}
.page-title {
  font-size: 2rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
  color: var(--text);
}
.page-subtitle {
  color: var(--text-muted);
  font-size: 1.05rem;
  margin: 0 0 1.5rem;
  line-height: var(--doc-line-height);
}
.doc-link {
  color: var(--link);
  text-decoration: none;
  font-weight: 500;
}
.doc-link:hover {
  text-decoration: underline;
}
</style>
