/**
 * ARS LLM helpers — gpt-4.1-mini labeling + leaf ments.
 * Charges tenant via updateTokenUsage + auditMonthly purpose ars_mapping.
 */
const OpenAI = require("openai");
const environment = require("@/env");
const { AppConfig } = require("@/const/AppConfig");
const { mergeOpenAiChatLimits } = require("@/utils/openAiNano");
const updateTokenUsage = require("@/utils/updateTokenUsage");
const { recordAuditMonthly } = require("@/utils/auditMonthly");
const { logInfo, logWarn, logAndCaptureError } = require("@/utils/logger");
const { isArsOtherLabel } = require("@/const/ArsMenuStatus");
const {
  sanitizeMenuLabel,
  labelHintFromText,
  fieldsFromRow,
  inferSectionFieldKeys,
  fieldValueFromRow
} = require("@/utils/arsGrouping");

const MODEL = AppConfig.DEFAULT_OPENAI_LITE_MODEL;
const BATCH_SIZE = 100;

let openai = null;
function getOpenAI() {
  if (!openai) {
    const key = environment.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is required for ARS mapping");
    openai = new OpenAI({ apiKey: key });
  }
  return openai;
}

/**
 * @param {string} tenantId
 * @param {object} usage - openai usage object
 * @param {object} [meta]
 */
async function chargeTenant(tenantId, usage, meta = {}) {
  const input = Number(usage?.prompt_tokens || usage?.input_tokens || 0);
  const output = Number(usage?.completion_tokens || usage?.output_tokens || 0);
  const total = Number(usage?.total_tokens || input + output || 0);
  logInfo("[arsLlm] charge tokens", {
    tenant_id: tenantId,
    function_name: "chargeTenant",
    extra: {
      purpose: "ars_mapping",
      model: MODEL,
      step: meta.step || null,
      batch_index: meta.batch_index ?? null,
      batch_total: meta.batch_total ?? null,
      leaf_index: meta.leaf_index ?? null,
      leaf_total: meta.leaf_total ?? null,
      input_tokens: input,
      output_tokens: output,
      total_tokens: total
    }
  });
  if (total > 0) {
    await updateTokenUsage(tenantId, total, {
      purpose: "ars_mapping",
      step: meta.step || null,
      batch_index: meta.batch_index ?? null,
      batch_total: meta.batch_total ?? null,
      leaf_index: meta.leaf_index ?? null,
      leaf_total: meta.leaf_total ?? null
    });
  }
  await recordAuditMonthly(tenantId, [
    {
      model: MODEL,
      purpose: "ars_mapping",
      input_tokens: input,
      output_tokens: output,
      api_provider: "openai"
    }
  ]);
}

async function chatJson({ tenantId, system, user, maxTokens = 2000, meta = {} }) {
  logInfo("[arsLlm] openai chat start", {
    tenant_id: tenantId,
    function_name: "chatJson",
    extra: {
      purpose: "ars_mapping",
      model: MODEL,
      step: meta.step || null,
      batch_index: meta.batch_index ?? null,
      batch_total: meta.batch_total ?? null,
      rows_in_batch: meta.rows_in_batch ?? null,
      leaf_index: meta.leaf_index ?? null,
      leaf_total: meta.leaf_total ?? null,
      leaf_label: meta.leaf_label || null,
      max_tokens: maxTokens
    }
  });
  const client = getOpenAI();
  const params = mergeOpenAiChatLimits(
    {
      model: MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    },
    maxTokens
  );
  const res = await client.chat.completions.create(params);
  await chargeTenant(tenantId, res.usage, meta).catch((err) => {
    logWarn("[arsLlm] chargeTenant failed", {
      tenant_id: tenantId,
      function_name: "chatJson",
      extra: {
        error: err?.message || String(err),
        step: meta.step || null
      }
    });
    logAndCaptureError(
      err instanceof Error ? err : new Error(String(err)),
      "[arsLlm] chargeTenant failed",
      {
        tenant_id: tenantId || "unknown",
        function_name: "chatJson",
        extra: { step: meta.step || null }
      }
    );
  });
  const raw = res.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Label rows with ARS depth1/2/3 short menu names.
 * When JSONL text has structured "Key: value" columns, infer the section field
 * statistically (no fixed header names) and anchor depth so rows stay with peers.
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {Array<{rowId: string, text: string, rowMeta?: object|null}>} opts.rows
 * @param {string[]} [opts.knownDepth1]
 * @param {(p: number) => Promise<void>} [opts.onProgress]
 */
async function labelRowsBatch({ tenantId, rows, knownDepth1 = [], onProgress }) {
  const labeled = [];
  const taxonomy = [...knownDepth1];
  const rowsTotal = rows.length;
  const total = rowsTotal || 1;
  const batchTotal = Math.max(1, Math.ceil(rowsTotal / BATCH_SIZE));

  const { categoryKey, subcategoryKey } = inferSectionFieldKeys(rows);
  const categorySet = new Set();
  if (categoryKey) {
    for (const r of rows) {
      const c = fieldValueFromRow(r, categoryKey);
      if (c) categorySet.add(c);
    }
  }
  const categoryList = [...categorySet].slice(0, 80);

  logInfo("[arsLlm] Pass A label start", {
    tenant_id: tenantId,
    function_name: "labelRowsBatch",
    extra: {
      step: "pass_a_label",
      batch_size: BATCH_SIZE,
      batch_total: batchTotal,
      rows_total: rowsTotal,
      known_depth1_count: taxonomy.length,
      inferred_category_key: categoryKey,
      inferred_subcategory_key: subcategoryKey,
      source_category_count: categorySet.size
    }
  });

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
    const rowsDoneAfter = Math.min(i + chunk.length, rowsTotal);
    const payload = chunk.map((r, idx) => {
      const fields = fieldsFromRow(r);
      const category = categoryKey ? fieldValueFromRow(r, categoryKey) || null : null;
      const subcategory = subcategoryKey
        ? fieldValueFromRow(r, subcategoryKey) || null
        : null;
      return {
        i: idx,
        row_id: r.rowId,
        fields,
        category,
        subcategory,
        text: String(r.text || "").slice(0, 1200)
      };
    });

    logInfo("[arsLlm] Pass A label batch", {
      tenant_id: tenantId,
      function_name: "labelRowsBatch",
      extra: {
        step: "pass_a_label_batch",
        batch_size: BATCH_SIZE,
        batch_index: batchIndex,
        batch_total: batchTotal,
        rows_in_batch: chunk.length,
        rows_done: rowsDoneAfter,
        rows_total: rowsTotal
      }
    });

    const system = `You build ARS (IVR) phone menu labels for FAQ rows.
Return JSON: {"items":[{"i":0,"depth1":"...","depth2":"...","depth3":null}]}
Rules:
- Each row may include structured "fields" (header→value from the source spreadsheet) plus optional "category" / "subcategory" (inferred section columns for this dataset). Trust structured fields over free-text guessing.
- When category is present:
  - depth2 MUST be that category value (same wording; shorten only if required for a keypad).
  - depth1 MUST be a broader parent that correctly contains that category. Never park a row under a sibling category from a different product section.
  - depth1 must NOT be a different value from the known source category list below (those are peer sections, not parents).
- When category is absent: depth1 required as ONE broad top-level topic; use depth2/depth3 to deepen.
- Each of depth1 / depth2 / depth3 must be a SINGLE topic. Never concatenate multiple topics with middots · or •.
- Use depth2 and depth3 to keep each parent under ~8 sibling options. Max depth 3.
- When many related topics exist, DEEPEN — never flatten into a long sibling list and never merge sibling names into one string.
- NEVER use catch-all / leftover / misc bucket labels in any language.
- Sibling labels under the same parent must be distinct and reusable across rows.
- Prefer reusing existing depth1 labels when possible: ${JSON.stringify(taxonomy.slice(0, 40))}
- Known source category values in this dataset (do not use as depth1 for a row whose category differs): ${JSON.stringify(categoryList)}
- Language of labels must match the row text language (any language). Do not translate into another language.`;

    const parsed = await chatJson({
      tenantId,
      system,
      user: JSON.stringify({ rows: payload }),
      maxTokens: 12000,
      meta: {
        step: "pass_a_label_batch",
        batch_index: batchIndex,
        batch_total: batchTotal,
        rows_in_batch: chunk.length,
        rows_done: rowsDoneAfter,
        rows_total: rowsTotal
      }
    });
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const byI = new Map(items.map((it) => [Number(it.i), it]));

    for (let j = 0; j < chunk.length; j += 1) {
      const it = byI.get(j) || {};
      const categoryHint = categoryKey
        ? fieldValueFromRow(chunk[j], categoryKey)
        : "";
      const subHint = subcategoryKey
        ? fieldValueFromRow(chunk[j], subcategoryKey)
        : "";
      const textHint = labelHintFromText(chunk[j].text);

      let depth1 = sanitizeMenuLabel(it.depth1, "");
      let depth2 = sanitizeMenuLabel(it.depth2, "") || undefined;
      let depth3 = sanitizeMenuLabel(it.depth3, "") || undefined;

      if (categoryHint) {
        const depth1IsForeignCategory =
          !!depth1 && depth1 !== categoryHint && categorySet.has(depth1);
        if (!depth1 || depth1IsForeignCategory) {
          depth1 = categoryHint;
          depth2 =
            (depth2 && depth2 !== categoryHint ? depth2 : undefined) ||
            (subHint && subHint !== categoryHint ? subHint : undefined);
        } else {
          depth2 = categoryHint;
          if (subHint && subHint !== depth1 && subHint !== depth2) {
            depth3 =
              depth3 && depth3 !== depth1 && depth3 !== depth2 ? depth3 : subHint;
          }
        }
      } else {
        depth1 =
          depth1 ||
          textHint ||
          labelHintFromText(chunk[j].rowId) ||
          `#${j + 1}`;
      }

      if (depth2 === depth1) depth2 = undefined;
      if (depth3 === depth1 || depth3 === depth2) depth3 = undefined;
      if (!depth1) {
        depth1 =
          categoryHint ||
          textHint ||
          labelHintFromText(chunk[j].rowId) ||
          `#${j + 1}`;
      }

      if (!taxonomy.includes(depth1)) taxonomy.push(depth1);
      labeled.push({
        rowId: chunk[j].rowId,
        text: chunk[j].text,
        depth1,
        depth2,
        depth3
      });
    }

    logInfo("[arsLlm] Pass A label batch done", {
      tenant_id: tenantId,
      function_name: "labelRowsBatch",
      extra: {
        step: "pass_a_label_batch_done",
        batch_index: batchIndex,
        batch_total: batchTotal,
        rows_done: rowsDoneAfter,
        rows_total: rowsTotal,
        items_returned: items.length,
        taxonomy_size: taxonomy.length
      }
    });

    if (onProgress) {
      await onProgress(Math.min(55, Math.round(((i + chunk.length) / total) * 50) + 5));
    }
  }

  logInfo("[arsLlm] Pass A label complete", {
    tenant_id: tenantId,
    function_name: "labelRowsBatch",
    extra: {
      step: "pass_a_label_complete",
      rows_total: rowsTotal,
      labeled_count: labeled.length,
      batch_total: batchTotal
    }
  });
  return labeled;
}

/**
 * True if source likely needs TTS rewrite (tables, markup, symbols).
 * Even without this, generateLeafAnswer always asks the LLM to verbalize.
 */
function looksNonSpoken(text) {
  const s = String(text || "");
  if (!s) return false;
  return (
    /\|/.test(s) ||
    /\t/.test(s) ||
    /```/.test(s) ||
    /<\/?[a-z][\s\S]*>/i.test(s) ||
    /\[[^\]]+\]\([^)]+\)/.test(s) ||
    /https?:\/\//i.test(s) ||
    /www\./i.test(s) ||
    /[★☆●○◆◇■□▲△▼▽※→←↑↓↔⇒⇔·•‣▪▫]/u.test(s) ||
    /[【】『』「」〈〉《》〔〕]/u.test(s) ||
    /[♪♫⚡✓✔✕✖™®©]/u.test(s) ||
    /_{2,}|\*{2,}|#{1,6}\s/.test(s) ||
    /\n\s*[-*+]\s/.test(s) ||
    /\n\s*\d+[.)]\s/.test(s)
  );
}

/**
 * Greetings are forbidden by the leaf prompt (any language).
 * No locale word-list stripping here — that would bias one language and can clip real short answers.
 */
function stripLeadingGreeting(text) {
  return String(text || "").trim();
}

/**
 * Speakable stub when LLM fails — never return raw FAQ/table text.
 */
function buildSafeSpokenFallback(label, texts) {
  for (const raw of texts || []) {
    const cleaned = String(raw || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/<\/?[a-z][^>]*>/gi, " ")
      .replace(/\[[^\]]*\]\([^)]+\)/g, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/[|*_#>`~]+/g, " ")
      .replace(/[★☆●○◆◇■□▲△▼▽※→←↑↓·•]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned && cleaned.length <= 400 && !looksNonSpoken(cleaned)) {
      return cleaned;
    }
  }
  const topic = isArsOtherLabel(label) ? "" : String(label || "").trim();
  if (!topic) return "";
  // Menu label alone is usually short and keypad-safe.
  return topic;
}

/**
 * Generate one ARS spoken ment for a leaf.
 * Always rewrite via LLM so tables / markup / symbols become speakable prose.
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.label
 * @param {string[]} opts.candidateTexts
 * @param {object} [opts.meta]
 */
async function generateLeafAnswer({ tenantId, label, candidateTexts, meta = {} }) {
  const texts = (candidateTexts || []).map((t) => String(t || "").slice(0, 1500)).filter(Boolean);
  if (texts.length === 0) {
    logInfo("[arsLlm] Pass C leaf skip empty sources", {
      tenant_id: tenantId,
      function_name: "generateLeafAnswer",
      extra: {
        step: "pass_c_leaf_empty",
        leaf_index: meta.leaf_index ?? null,
        leaf_total: meta.leaf_total ?? null,
        leaf_label: label || null
      }
    });
    return { answer_text: "", needs_review: true };
  }

  const topic = isArsOtherLabel(label)
    ? ""
    : String(label || "").trim();

  const system = `You write one ARS (IVR) phone-menu answer that will be read aloud by text-to-speech.
Return JSON: {"answer_text":"...","needs_review":false}

Topic to cover only: ${topic ? JSON.stringify(topic) : "(cover only what the sources support for this menu key)"}

Content rules:
- Use ONLY facts from the sources. Do not invent.
- Same language as the sources. Do not translate into another language.
- One continuous spoken answer. Prefer under 500 characters; hard max ~800.
- Do not mix unrelated topics from the sources.
- The caller already selected this menu key. Start with the answer itself — no greeting, no courtesy opener, no closing goodbye, in any language.
- Do not thank the caller for calling/contacting unless that sentence is required by the sources.

Speech / TTS rules (critical):
- Write as natural spoken sentences a caller hears on the phone. Not a document.
- Convert tables, CSV-like rows, markdown tables, and columnar layouts into plain sentences (e.g. "A is B. C is D.").
- Remove or verbalize markup: markdown, HTML, code fences, bullets, numbering symbols.
- Do not read punctuation or symbols aloud as characters. Avoid pipes |, asterisks, hashes, arrows, emoji, decorative bullets.
- URLs / emails: say the destination in words if useful, or skip if not needed for the answer. Never spell out full URLs with slashes.
- Special chars (™ ® © ※ · • → etc.): drop or rephrase in words.
- Numbers and money: speak naturally for the source language (prefer spoken forms over dense digit dumps).
- Line breaks and lists: turn into short connected sentences with natural connectors for that language.
- No markdown, no tables, no code, no raw special-character decoration in answer_text.

Set needs_review true only if sources are empty, contradictory, or too unclear to make a safe spoken answer.`;

  let parsed = {};
  try {
    parsed = await chatJson({
      tenantId,
      system,
      user: JSON.stringify({
        topic: topic || null,
        sources: texts.slice(0, 6),
        hint: texts.some(looksNonSpoken)
          ? "Sources contain table/markup/symbols — verbalize carefully for TTS. No greeting opener."
          : "Rewrite as spoken ARS prose in the source language. Start directly with the facts — no greeting."
      }),
      maxTokens: 1000,
      meta: {
        step: "pass_c_leaf_llm",
        leaf_index: meta.leaf_index ?? null,
        leaf_total: meta.leaf_total ?? null,
        leaf_label: label || null,
        source_count: texts.length
      }
    });
  } catch (err) {
    logWarn("[arsLlm] generateLeafAnswer LLM failed", {
      tenant_id: tenantId,
      function_name: "generateLeafAnswer",
      extra: {
        error: err?.message || String(err),
        label,
        leaf_index: meta.leaf_index ?? null,
        leaf_total: meta.leaf_total ?? null
      }
    });
    return {
      answer_text: buildSafeSpokenFallback(label, texts),
      needs_review: true
    };
  }

  const answer = stripLeadingGreeting(
    String(parsed.answer_text || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );

  if (!answer || looksNonSpoken(answer)) {
    return {
      answer_text: buildSafeSpokenFallback(label, texts),
      needs_review: true
    };
  }

  return {
    answer_text: answer,
    needs_review: parsed.needs_review === true
  };
}

module.exports = {
  labelRowsBatch,
  generateLeafAnswer,
  BATCH_SIZE
};
