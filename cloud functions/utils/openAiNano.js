function usesMaxCompletionTokensModel(model) {
  const m = String(model || "").trim().toLowerCase();
  return m.startsWith("gpt-5") || /^o\d/.test(m);
}

/**
 * GPT-5 / reasoning models use max_completion_tokens, GPT-4.x uses max_tokens.
 * Adjust output limit parameters per model in streamChatRag OpenAI Chat Completions call.
 */
function mergeOpenAiChatLimits(params, maxOutputTokens) {
  const base =
    params && typeof params === "object" ? { ...params } : {};
  const model = base.model;
  const visible = Math.max(1, Number(maxOutputTokens) || 1);

  delete base.max_tokens;
  delete base.max_completion_tokens;

  if (usesMaxCompletionTokensModel(model)) {
    // Add buffer for visible JSON/short output when reasoning_effort is "none".
    base.max_completion_tokens = Math.min(128000, Math.max(64, visible * 3));
    if (String(model).toLowerCase().startsWith("gpt-5")) {
      base.reasoning_effort = "none";
    }
  } else {
    base.max_tokens = visible;
  }

  return base;
}

module.exports = {
  mergeOpenAiChatLimits
};