const { MAX_ARS_DISPLAY_LENGTH } = require("../const/ArsLimits");

const DISPLAY = {
  type: "object",
  properties: { display_text: { type: "string" } },
  required: ["display_text"],
  additionalProperties: false
};

const INSTRUCTION = `Rewrite answer_text as an on-screen chat answer in Markdown that a customer can scan at a glance. answer_text is the only factual source; menu_path identifies the topic, not facts.
Keep every condition, deadline, time anchor, fee, amount, exception, contact channel and support hour from answer_text, with the same meaning. Do not add, generalize, soften or drop any of them. Do not invent steps, links, phone numbers or keypad numbers.
Structure: start with one short sentence stating the key answer. Then group the rest into short paragraphs or "-" bullet lists separated by blank lines. Use a numbered list only for steps that must happen in order. Use **bold** for deadlines, fees, amounts and must-do conditions, not whole sentences. A short bold label line may introduce a group; do not use # headings, tables, HTML, emoji or code.
Write concise phrases instead of long spoken sentences, in the same language as answer_text. No greeting, sign-off or restating the customer's question.`;

const digitsOf = (text) => new Set(String(text).match(/\d+/g) || []);

function validateDisplay({ display_text }, answerText) {
  const text = display_text.trim();
  if (!text) throw new Error("Display summary must not be empty");
  if (text.length > MAX_ARS_DISPLAY_LENGTH)
    throw new Error(`Display summary exceeds ${MAX_ARS_DISPLAY_LENGTH} characters`);
  if (/<\/?[a-z][^>]*>/i.test(text)) throw new Error("Display summary must use Markdown, not HTML");
  const allowed = digitsOf(answerText);
  const added = [...digitsOf(text.replace(/^\s*\d+[.)]\s/gm, ""))].filter((d) => !allowed.has(d));
  if (added.length)
    throw new Error(`Display summary adds numbers absent from answer_text: ${added.join(", ")}`);
}

// The spoken answer stays publishable without a summary, so failures return "" instead of failing the caller.
async function writeDisplayText({ ask, menuPath, answerText, ...askOptions }) {
  const answer = String(answerText || "").trim();
  if (!answer) return "";
  try {
    const result = await ask({
      name: "ars_display",
      schema: DISPLAY,
      data: { menu_path: menuPath, answer_text: answer },
      instruction: INSTRUCTION,
      validate: (value) => validateDisplay(value, answer),
      ...askOptions
    });
    return result.display_text.trim();
  } catch {
    return "";
  }
}

module.exports = { writeDisplayText, validateDisplay };
