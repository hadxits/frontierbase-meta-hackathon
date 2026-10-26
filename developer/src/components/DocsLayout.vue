<template>
  <div class="docs-layout">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <a href="/" class="brand-link">FrontierBase</a>
        <span class="brand-docs">Docs</span>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-section">
          <div class="nav-section-title">{{ t('nav.getStarted') }}</div>
          <router-link to="/" class="nav-link" active-class="" exact-active-class="active">{{ t('nav.welcome') }}</router-link>
          <router-link to="/session" class="nav-link" active-class="" exact-active-class="active">{{ t('nav.session') }}</router-link>
          <router-link to="/chat" class="nav-link" active-class="" exact-active-class="active">{{ t('nav.chat') }}</router-link>
          <router-link to="/messages" class="nav-link" active-class="" exact-active-class="active">{{ t('nav.messages') }}</router-link>
          <div class="nav-section-title nav-section-title-sub">{{ t('nav.frontendExamples') }}</div>
          <router-link to="/frontend-example" class="nav-link" exact-active-class="active">{{ t('nav.frontendExampleOverview') }}</router-link>
          <router-link to="/frontend-example/session" class="nav-link nav-link-sub" exact-active-class="active">{{ t('nav.frontendExampleSession') }}</router-link>
          <router-link to="/frontend-example/chat" class="nav-link nav-link-sub" exact-active-class="active">{{ t('nav.frontendExampleChat') }}</router-link>
          <router-link to="/frontend-example/messages" class="nav-link nav-link-sub" exact-active-class="active">{{ t('nav.frontendExampleMessages') }}</router-link>
          <router-link to="/frontend-example/integrated" class="nav-link nav-link-sub" exact-active-class="active">{{ t('nav.frontendExampleIntegrated') }}</router-link>
          <router-link to="/chatbot" class="nav-link" active-class="" exact-active-class="active">{{ t('nav.chatbot') }}</router-link>
        </div>
      </nav>
    </aside>
    <div class="main-wrap">
      <header class="topbar">
        <div class="topbar-spacer"></div>
        <ThemeToggle />
        <LanguageSelect />
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup>
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { updatePageSEO, injectJsonLd, generateWebsiteJsonLd } from '@/utils/seoUtils'
import LanguageSelect from './LanguageSelect.vue'
import ThemeToggle from './ThemeToggle.vue'

const { t, locale } = useI18n()
const route = useRoute()

const ROUTE_META_KEYS = {
  home: 'home',
  session: 'session',
  chat: 'chat',
  messages: 'messages',
  'frontend-example': 'frontendExample',
  'frontend-example-session': 'frontendExampleSession',
  'frontend-example-chat': 'frontendExampleChat',
  'frontend-example-messages': 'frontendExampleMessages',
  'frontend-example-integrated': 'frontendExampleIntegrated',
  chatbot: 'chatbot',
  'not-found': 'notFound'
}

function updateSEO() {
  const metaKey = ROUTE_META_KEYS[route.name] || 'home'
  updatePageSEO(
    {
      titleKey: `meta.${metaKey}.title`,
      descriptionKey: `meta.${metaKey}.description`,
      url: `https://developers.frontierbase.io${route.fullPath || '/'}`
    },
    t,
    locale.value
  )
  injectJsonLd(generateWebsiteJsonLd(t), 'website-jsonld')
}

watch([() => route.name, () => route.fullPath, locale], updateSEO, { immediate: true })
</script>

<style scoped>
.docs-layout {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 260px;
  min-width: 260px;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  padding: 1rem 0;
  position: sticky;
  top: 0;
  height: 100vh;
}
.sidebar-brand {
  padding: 0 1.25rem 1rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.75rem;
}
.brand-link {
  color: var(--text);
  text-decoration: none;
  font-weight: 600;
  font-size: 1.1rem;
}
.brand-docs {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-left: 0.35rem;
}
.nav-section-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding: 0.5rem 1.25rem 0.25rem;
}
.nav-link {
  display: block;
  padding: 0.4rem 1.25rem;
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.9rem;
  border-left: 2px solid transparent;
  margin-left: 0;
}
.nav-link:hover {
  color: var(--text);
}
.nav-link.active {
  color: var(--link);
  border-left-color: var(--link);
  background: var(--active-bg);
}
.nav-section-title-sub {
  margin-top: 0.5rem;
}
.nav-link-sub {
  padding-left: 1.75rem;
  font-size: 0.85rem;
}
.main-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.topbar {
  height: 52px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 1.5rem;
  background: var(--bg);
  position: sticky;
  top: 0;
  z-index: 10;
}
.topbar-spacer { flex: 1; }
.content {
  flex: 1;
  padding: 2rem 2.5rem 4rem;
  max-width: 820px;
  margin: 0 auto;
  width: 100%;
}
</style>
