<template>
  <div class="lang-wrap">
    <button class="lang-trigger" @click="open = !open" aria-haspopup="listbox" :aria-expanded="open">
      {{ currentLabel }}
    </button>
    <div v-if="open" class="lang-dropdown" role="listbox">
      <button
        v-for="opt in options"
        :key="opt.code"
        class="lang-option"
        :class="{ active: locale === opt.code }"
        @click="setLocale(opt.code)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { locale } = useI18n()
const open = ref(false)

const options = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
  { code: 'zh-TW', label: '繁體中文（台灣）' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
]

const currentLabel = computed(() => options.find(o => o.code === locale.value)?.label || 'English')

function setLocale(code) {
  locale.value = code
  try {
    localStorage.setItem('frontierbase-docs-locale', code)
  } catch (_) {}
  open.value = false
}

function close(e) {
  if (!e.target.closest('.lang-wrap')) open.value = false
}

onMounted(() => document.addEventListener('click', close))
onUnmounted(() => document.removeEventListener('click', close))
</script>

<style scoped>
.lang-wrap {
  position: relative;
}
.lang-trigger {
  background: var(--btn-bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
}
.lang-trigger:hover {
  background: var(--hover-bg);
}
.lang-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 140px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  z-index: 100;
}
.lang-option {
  display: block;
  width: 100%;
  padding: 0.5rem 1rem;
  text-align: left;
  background: none;
  border: none;
  color: var(--text);
  font-size: 0.875rem;
  cursor: pointer;
}
.lang-option:hover {
  background: var(--hover-bg);
}
.lang-option.active {
  color: var(--link);
}
</style>
