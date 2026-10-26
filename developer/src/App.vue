<template>
  <router-view />
</template>

<script setup>
import { useTheme } from '@/composables/useTheme'
useTheme()
</script>

<style>
  * { box-sizing: border-box; }

  [data-theme="dark"] {
    --bg: #0d1117;
    --sidebar-bg: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --text-dim: #c9d1d9;
    --link: #58a6ff;
    --code-bg: #161b22;
    --code-text: #79c0ff;
    --code-error: #ff7b72;
    --code-keyword: #ff7b72;
    --code-string: #a5d6ff;
    --code-number: #79c0ff;
    --code-comment: #8b949e;
    --code-attr: #7ee787;
    --btn-bg: #21262d;
    --hover-bg: #30363d;
    --active-bg: rgba(88, 166, 255, 0.08);
    --doc-line-height: 1.75;
  }

  [data-theme="light"] {
    --bg: #ffffff;
    --sidebar-bg: #f6f8fa;
    --border: #d0d7de;
    --text: #1f2328;
    --text-muted: #656d76;
    --text-dim: #424a53;
    --link: #0969da;
    --code-bg: #f6f8fa;
    --code-text: #0550ae;
    --code-error: #cf222e;
    --code-keyword: #cf222e;
    --code-string: #0a3069;
    --code-number: #0550ae;
    --code-comment: #656d76;
    --code-attr: #116329;
    --btn-bg: #f6f8fa;
    --hover-bg: #eaeef2;
    --active-bg: rgba(9, 105, 218, 0.08);
    --doc-line-height: 1.75;
  }

  /* Syntax highlighting (highlight.js) */
  .code-block .hljs { color: var(--text-dim); background: transparent; }
  .code-block .hljs-keyword,
  .code-block .hljs-built_in { color: var(--code-keyword); }
  .code-block .hljs-string { color: var(--code-string); }
  .code-block .hljs-number { color: var(--code-number); }
  .code-block .hljs-comment { color: var(--code-comment); font-style: italic; }
  .code-block .hljs-attr { color: var(--code-attr); }
  .code-block .hljs-title.function_ { color: var(--code-keyword); }
  .code-block .hljs-params { color: var(--text-dim); }
  .code-block .hljs-title.class_ { color: var(--code-attr); }
  .code-block .hljs-variable { color: var(--code-text); }
  .code-block .hljs-tag { color: var(--code-keyword); }
  .code-block .hljs-name { color: var(--code-attr); }
  .code-block .hljs-meta { color: var(--code-comment); }

  html, body {
    overscroll-behavior-y: none;
    overscroll-behavior: none;
  }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: var(--doc-line-height);
  }
  #app { min-height: 100vh; overscroll-behavior: none; }

  /* Shared doc body text — same rhythm for prose, notes, tables, lists */
  .content .page-desc,
  .content .muted,
  .content .prose,
  .content .prose-block p,
  .content .params,
  .content .steps,
  .content .steps li,
  .content .note,
  .content .list-disc li,
  .content .doc-table td,
  .content .params-table td,
  .content .callout p,
  .content .pre-line {
    line-height: var(--doc-line-height);
  }
</style>
