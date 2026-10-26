<template>
  <button
    type="button"
    class="theme-toggle"
    :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
    @click="toggle"
  >
    <span class="icon sun" aria-hidden="true">☀️</span>
    <span class="icon moon" aria-hidden="true">🌙</span>
  </button>
</template>

<script setup>
import { useTheme } from '@/composables/useTheme'

const { theme, toggle } = useTheme()
</script>

<style scoped>
.theme-toggle {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--btn-bg);
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  margin-right: 0.5rem;
}
.theme-toggle:hover {
  background: var(--hover-bg);
}
.icon {
  display: block;
}
/* Show icon for the mode we’ll switch to: dark → sun, light → moon */
[data-theme="dark"] .icon.sun {
  display: block;
}
[data-theme="dark"] .icon.moon {
  display: none;
}
[data-theme="light"] .icon.sun {
  display: none;
}
[data-theme="light"] .icon.moon {
  display: block;
}
</style>
