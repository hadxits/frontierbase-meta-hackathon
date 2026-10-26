import { ref, watch, onMounted } from 'vue'

const STORAGE_KEY = 'frontierbase-docs-theme'

function getSystemTheme() {
  try {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
    return 'light'
  } catch (_) {
    return 'dark'
  }
}

function getInitialTheme() {
  try {
    const p = new URLSearchParams(window.location.search)
    const t = (p.get('theme') || p.get('thema') || '').toLowerCase()
    if (t === 'light' || t === 'dark') return t
    const s = localStorage.getItem(STORAGE_KEY)
    if (s === 'light' || s === 'dark') return s
    return getSystemTheme()
  } catch (_) {
    return 'dark'
  }
}

const theme = ref(getInitialTheme())

function applyTheme(value) {
  document.documentElement.setAttribute('data-theme', value)
}

function setTheme(value) {
  if (value !== 'dark' && value !== 'light') return
  theme.value = value
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch (_) {}
  applyTheme(value)
}

function toggle() {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}

export function useTheme() {
  onMounted(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'light' || stored === 'dark') {
        theme.value = stored
      }
    } catch (_) {}
    applyTheme(theme.value)
  })
  return { theme, setTheme, toggle }
}
