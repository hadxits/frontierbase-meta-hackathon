const MAX_ARS_ANSWER_LENGTH = 2500;
const MAX_ARS_ANSWER_WORDS = 150;
const MAX_ARS_DISPLAY_LENGTH = 3000;

// Count whitespace-separated words; unspaced text still has the character limit.
function countArsAnswerWords(text) {
  return String(text || "").match(/\S+/gu)?.length || 0;
}

module.exports = {
  MAX_ARS_ANSWER_LENGTH,
  MAX_ARS_ANSWER_WORDS,
  MAX_ARS_DISPLAY_LENGTH,
  countArsAnswerWords
};
