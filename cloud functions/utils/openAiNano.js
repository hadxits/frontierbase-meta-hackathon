function usesMaxCompletionTokensModel(model) {
  const m = String(model || "").trim().toLowerCase();
  return m.startsWith("gpt-5") || /^o\d/.test(m);
}

/**
 * GPT-5 / reasoning 모델은 max_completion_tokens, GPT-4.x는 max_tokens.
 * streamChatRag OpenAI Chat Completions 호출에서 model별 출력 한도 파라미터를 맞춘다.
 */
function mergeOpenAiChatLimits(params, maxOutputTokens) {
  const base =
    params && typeof params === "object" ? { ...params } : {};
  const model = base.model;
  const visible = Math.max(1, Number(maxOutputTokens) || 1);

  delete base.max_tokens;
  delete base.max_completion_tokens;

  if (usesMaxCompletionTokensModel(model)) {
    // reasoning_effort "none" 기준 visible JSON/짧은 출력에 여유 버퍼
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