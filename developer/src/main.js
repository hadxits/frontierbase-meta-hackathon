import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import App from './App.vue'
import router from './router'
import messages from './i18n/locales'

const VALID_LOCALES = Object.keys(messages)

/**
 * Normalize raw locale (?locale=, localStorage) to a supported UI locale.
 * Chinese variants (`zh`, `zh-HK`, `zh-TW`, …) → `zh-TW`.
 */
function normalizeLocale(raw) {
  const loc = String(raw ?? '')
    .trim()
    .replace(/_/g, '-')
  if (!loc) return null

  const lower = loc.toLowerCase()
  if (lower === 'zh' || lower.startsWith('zh-')) {
    return 'zh-TW'
  }

  if (VALID_LOCALES.includes(loc)) return loc
  if (VALID_LOCALES.includes(lower)) return lower
  return null
}

function getUrlParams() {
  try {
    const p = new URLSearchParams(window.location.search)
    return {
      locale: p.get('locale') || p.get('lang') || null,
      theme: (p.get('theme') || p.get('thema') || 'dark').toLowerCase(),
    }
  } catch (_) {
    return { locale: null, theme: 'dark' }
  }
}

const urlParams = getUrlParams()

function getSystemTheme() {
  try {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
    return 'light'
  } catch (_) {
    return 'dark'
  }
}

// Theme: URL param > localStorage > system theme > default dark
try {
  const themeValue =
    urlParams.theme === 'light' || urlParams.theme === 'dark'
      ? urlParams.theme
      : localStorage.getItem('frontierbase-docs-theme') === 'light' || localStorage.getItem('frontierbase-docs-theme') === 'dark'
        ? localStorage.getItem('frontierbase-docs-theme')
        : getSystemTheme()
  document.documentElement.setAttribute('data-theme', themeValue)
  if (urlParams.theme === 'light' || urlParams.theme === 'dark') {
    localStorage.setItem('frontierbase-docs-theme', urlParams.theme)
  }
} catch (_) {
  document.documentElement.setAttribute('data-theme', 'dark')
}

// Locale: URL param (if present) > localStorage > default 'en'. Query wins only when it has a value.
const savedLocale = typeof localStorage !== 'undefined' ? localStorage.getItem('frontierbase-docs-locale') : null
const urlLocale = normalizeLocale(urlParams.locale)
const initialLocale = urlLocale || normalizeLocale(savedLocale) || 'en'

const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  messages,
})

const app = createApp(App)
app.use(router)
app.use(i18n)
app.mount('#app')
