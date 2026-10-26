<template>
  <div class="page">
    <h1 class="page-title">{{ t('feChat.title') }}</h1>
    <p class="page-desc pre-line">{{ t('feChat.description') }}</p>
    <section class="section">
      <h2 class="section-title">{{ t('feChat.streamingNoteTitle') }}</h2>
      <p class="muted pre-line">{{ t('feChat.streamingNoteDesc') }}</p>
    </section>
    <section class="section">
      <h2 class="section-title">{{ t('feChat.callTitle') }}</h2>
      <p class="muted pre-line">{{ t('feChat.callDesc') }}</p>
      <CodeBlock :code="callExample" lang="javascript" />
    </section>
    <section class="section">
      <h2 class="section-title">{{ t('feChat.receiveTitle') }}</h2>
      <p class="muted pre-line">{{ t('feChat.receiveDesc') }}</p>
      <CodeBlock :code="receiveExample" lang="javascript" />
    </section>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import CodeBlock from '@/components/CodeBlock.vue'

const { t } = useI18n()

const callExample = `// POST /chat with Bearer token. Pass \`signal\` to allow abort (e.g. user clicks "Stop").
const controller = new AbortController();

const res = await fetch("https://api.frontierbase.io/chat", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + clientToken,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    plugin_key: "PLUGIN_KEY",
    message: "Hello",
    locale: "en",
    dataset_ids: ["purpose-a", "purpose-b"],  // optional: RAG search target dataset IDs
  }),
  signal: controller.signal,  // controller.abort() to cancel request + stream
});

if (!res.ok) {
  const err = await res.json().catch(() => ({}));
  throw new Error(err?.message || "HTTP " + res.status);
}
// res.body is a ReadableStream — parse SSE below.`

const receiveExample = `// SSE parser with callbacks. Events: status, delta, error, done.
async function readChatStream(res, { onStatus, onDelta, onStreamError, onDone, onParseError, signal } = {}) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let eventName = "message";
  let streamFailed = false;

  const emit = (event, dataStr) => {
    let payload = null;
    try {
      payload = JSON.parse(dataStr);
    } catch {
      payload = { text: dataStr };
    }
    if (event === "status") onStatus?.(payload);
    else if (event === "delta" && !streamFailed) onDelta?.(payload);
    else if (event === "error") {
      streamFailed = true;
      onStreamError?.(payload);
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE: events separated by blank line (\\n\\n). Comment lines (": ping ...") ignored.
      let idx;
      while ((idx = buffer.indexOf("\\n\\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (raw.startsWith(":")) continue;

        const lines = raw.split("\\n");
        const dataLines = [];
        eventName = "message";
        for (const line of lines) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        const dataStr = dataLines.join("\\n");
        if (dataStr) emit(eventName, dataStr);
      }
    }
    onDone?.({ ok: true, aborted: streamFailed });
  } catch (e) {
    if (e?.name === "AbortError") {
      onDone?.({ aborted: true });
    } else {
      onParseError?.({ message: String(e?.message || e) });
    }
    throw e;
  }
}

function showAssistantError(message) {
  // Same idea as the embedded chatbot: show API errors in the assistant status area.
  statusEl.textContent = message;
  statusEl.classList.add("visible", "error");
}

// Usage with callbacks and abort:
// const ctrl = new AbortController();
// const res = await fetch(url, { ...opts, signal: ctrl.signal });
// readChatStream(res, {
//   onStatus: (p) => setProgress(p.text),
//   onDelta:  (p) => { fullText += p.text || ""; updateUI(fullText); },
//   onStreamError: (p) => {
//     const msg = (p.message && p.message.trim()) ? p.message.trim() : "Request failed";
//     showAssistantError(msg);
//   },
//   onDone:   (p) => console.log("Done", p),
//   onParseError: (p) => showAssistantError(p.message),
//   signal:   ctrl.signal
// });
// To cancel: ctrl.abort();`
</script>

<style scoped>
.page-title { font-size: 2rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--text); }
.page-desc { color: var(--text-muted); margin: 0 0 2rem; line-height: var(--doc-line-height); }
.section { margin-bottom: 2rem; }
.section-title { font-size: 1.25rem; margin: 0 0 0.75rem; color: var(--text); }
.muted { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.5rem; }
.pre-line { white-space: pre-line; }
</style>
