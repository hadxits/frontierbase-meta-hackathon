/**
 * Filter vector search results by score
 * @param {Array} results - Qdrant search results array [{ id, score, payload }, ...]
 * @param {Object} [options]
 * @param {number} [options.maxResults=10] - maximum number to keep (to match context chunk count)
 * @param {number} [options.minScore=0.4] - minimum score (to align with Qdrant score_threshold)
 * @returns {Array} - filtered results array
 *
 * The previous tier method discarded all lower tiers if a higher tier existed,
 * which could excessively reduce results to about two depending on query distribution.
 *
 * Therefore, without hardcoding question types, results are sorted by descending score
 * and a simple policy keeps results above minScore up to maxResults.
 */
function filterResultsByScore(results, options = {}) {
  if (!results || !Array.isArray(results) || results.length === 0) {
    return [];
  }

  const maxResultsRaw = Number(options?.maxResults);
  const maxResults = Number.isFinite(maxResultsRaw) && maxResultsRaw > 0
    ? Math.floor(maxResultsRaw)
    : 10;

  // minScore:
  // - In dense search (score≈cosine), thresholds like 0.4 are meaningful
  // - Hybrid (RRF) search scores have different scales; using thresholds may over-filter → null disables threshold
  const minScore =
    options?.minScore === null
      ? -Infinity
      : Number.isFinite(Number(options?.minScore))
        ? Number(options?.minScore)
        : 0.4;

  return results
    .filter((r) => typeof r?.score === "number" && r.score >= minScore)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, maxResults);
}

// ============================================================================
// Common formatting function
// ============================================================================

/**
 * Format row data into text for LLM context
 * @param {Object} rowData - Firestore row document data
 * @param {number} maxLength - maximum length (default: 2000)
 * @returns {string} formatted text
 */
function formatRowDataForContext(rowData, maxLength = 2000) {
  if (!rowData) return "";

  let formattedText = "";

  // The text field is stored as "key: value\nkey: value" format
  if (rowData?.text) {
    let text = rowData.text;

    // If text exceeds maxLength, cut by lines
    if (text.length > maxLength) {
      const lines = text.split("\n");
      const truncatedLines = [];
      let currentLength = 0;

      for (const line of lines) {
        const lineLength = line.length + 1; // +1 for newline

        if (currentLength + lineLength > maxLength) {
          // If adding the current line exceeds maxLength, cut the last line to fit
          const remaining = maxLength - currentLength;
          if (remaining > 0) {
            truncatedLines.push(line.slice(0, remaining));
          }
          break;
        }

        truncatedLines.push(line);
        currentLength += lineLength;
      }

      formattedText = truncatedLines.join("\n");
      if (lines.length > truncatedLines.length || text.length > currentLength) {
        formattedText += "\n...";
      }
    } else {
      // If text is short enough, use as is
      formattedText = text;
    }
  }

  return formattedText;
}

// ============================================================================
// RAG context construction function
// ============================================================================

/**
 * Extract keywords/entities from recent messages (regex-based, no LLM used to save tokens)
 * Multilingual support: Korean, English, Japanese, Chinese, German, French, Italian
 * Extract only meaningful keywords based on length and frequency without hardcoded stop words
 * @param {Array} recentMessages - array of recent messages
 * @returns {Set<string>} - set of extracted keywords
 */
function extractKeywordsFromMessages(recentMessages) {
  const keywordCounts = new Map(); // Track frequency per keyword

  if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
    return new Set();
  }

  // Multilingual regex pattern
  // - Korean: \uAC00-\uD7A3 (2 or more characters)
  // - English: a-zA-Z (3 or more characters)
  // - Japanese Hiragana: \u3040-\u309F (2 or more characters)
  // - Japanese Katakana: \u30A0-\u30FF (2 or more characters)
  // - Japanese/Chinese Kanji: \u4E00-\u9FFF (1 or more characters, even one Kanji is meaningful)
  // - European languages (German/French/Italian): a-zA-Z + Latin extended characters \u00C0-\u017F (3 or more characters)
  const multilingualPattern = /[\uAC00-\uD7A3]{2,}|[a-zA-Z\u00C0-\u017F]{3,}|[\u3040-\u309F]{2,}|[\u30A0-\u30FF]{2,}|[\u4E00-\u9FFF]+/g;

  // Extract keywords and calculate frequency from recent messages
  for (const msg of recentMessages) {
    const content = msg.content || "";
    if (!content || typeof content !== "string") continue;

    // Extract words using multilingual patterns
    const words = content.match(multilingualPattern) || [];

    words.forEach(word => {
      // Exclude words that contain only numbers
      if (/^\d+$/.test(word)) return;

      // Verify minimum length per language
      let isValidKeyword = false;
      let normalizedWord = word;

      // Korean: 2 or more characters
      if (/[\uAC00-\uD7A3]/.test(word) && word.length >= 2) {
        isValidKeyword = true;
        normalizedWord = word.toLowerCase();
      }
      // English/European languages: 3 or more characters (including Latin extended characters)
      else if (/[a-zA-Z\u00C0-\u017F]/.test(word) && word.length >= 3) {
        isValidKeyword = true;
        normalizedWord = word.toLowerCase();
      }
      // Japanese Hiragana: 2 or more characters
      else if (/[\u3040-\u309F]/.test(word) && word.length >= 2) {
        isValidKeyword = true;
        normalizedWord = word; // Hiragana is case-insensitive
      }
      // Japanese Katakana: 2 or more characters
      else if (/[\u30A0-\u30FF]/.test(word) && word.length >= 2) {
        isValidKeyword = true;
        normalizedWord = word; // Katakana is case-insensitive
      }
      // Japanese/Chinese Kanji: 1 or more characters (one Kanji is meaningful)
      else if (/[\u4E00-\u9FFF]/.test(word) && word.length >= 1) {
        isValidKeyword = true;
        normalizedWord = word; // Kanji is case-insensitive
      }

      if (isValidKeyword) {
        keywordCounts.set(normalizedWord, (keywordCounts.get(normalizedWord) || 0) + 1);
      }
    });
  }

  // Return only keywords with frequency 2 or more (meaningful keywords only)
  // Single occurrences are likely noise
  const keywords = new Set();
  for (const [keyword, count] of keywordCounts.entries()) {
    if (count >= 2) {
      keywords.add(keyword);
    }
  }

  return keywords;
}

/**
 * Filter out information duplicated with recent messages in RAG context
 * Use regex-based keyword matching (no LLM usage - saves tokens)
 * Multilingual support: use only keyword matching without hardcoding
 * @param {Array} results - Qdrant search results
 * @param {Set<string>} recentKeywords - Keywords extracted from recent messages (frequency 2 or more)
 * @returns {Array} - Filtered results
 */
function filterDuplicateRagContext(results, recentKeywords) {
  if (!recentKeywords || recentKeywords.size === 0) {
    return results; // Do not filter if there are no keywords
  }

  // Do not filter if there are too few keywords (to avoid noise)
  // Since only keywords with frequency 2 or more are used, at least 3 are needed to be meaningful
  if (recentKeywords.size < 3) {
    return results;
  }

  // Exclude results whose text contains many recent message keywords
  const filtered = [];

  for (const result of results) {
    const text = result.payload?.text || "";
    if (!text) {
      filtered.push(result); // Include if there is no text
      continue;
    }

    const textLower = text.toLowerCase();
    let keywordMatchCount = 0;

    // Count keyword matches (consider word boundaries, support multilingual)
    for (const keyword of recentKeywords) {
      // Escape regex special characters
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Matching strategy per language
      let regex;
      
      // Korean: no word boundaries, check direct inclusion
      if (/[\uAC00-\uD7A3]/.test(keyword)) {
        regex = new RegExp(escapedKeyword, 'i');
      }
      // Japanese Hiragana/Katakana: no word boundaries, check direct inclusion
      else if (/[\u3040-\u309F\u30A0-\u30FF]/.test(keyword)) {
        regex = new RegExp(escapedKeyword, 'i');
      }
      // Japanese/Chinese Kanji: no word boundaries, check direct inclusion
      else if (/[\u4E00-\u9FFF]/.test(keyword)) {
        regex = new RegExp(escapedKeyword, 'i');
      }
      // English/European languages: consider word boundaries (including Latin extended characters)
      else {
        regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
      }

      if (regex.test(textLower)) {
        keywordMatchCount++;
      }
    }

    // Calculate keyword matching ratio
    const matchRatio = keywordMatchCount / recentKeywords.size;

    // Include if matching ratio is low (below 25%)
    // If too many keywords match, the information is likely already mentioned in recent messages.
    // 25% threshold: If major keywords (frequency 2 or more) in recent messages are heavily included in the RAG context, consider it duplicate.
    if (matchRatio < 0.25) {
      filtered.push(result);
    }
    // Exclude if matchRatio >= 0.25 (duplicate with recent message).
  }

  return filtered;
}

// ✅ Improvement: Greatly simplified by storing text/embedding_text and version in Qdrant payload.
// Removed Firestore lookup, no memory cache needed, no validateRecordRef needed (already verified by Qdrant filter).
async function buildRagContextFromResults({
                                            results,
                                            tenant_id,
                                            MAX_CONTEXT_CHUNKS,
                                            MAX_CONTEXT_CHARS_EACH,
                                            recentMessages = null // Recent messages (for duplicate filtering).
                                          }) {
  const normalizedTenantId = String(tenant_id || "").toLowerCase();
  const pickContextText = (payload, drop) => {
    const tRaw = payload?.text;
    const etRaw = payload?.embedding_text;
    const t = typeof tRaw === "string" ? tRaw.trim() : null;
    const et = typeof etRaw === "string" ? etRaw.trim() : null;

    // Use original text first for context since it's the human-readable source.
    // embedding_text improves search quality by removing labels but may lose information for answer context, so use only as fallback.
    if (t && t.length > 0) return tRaw;
    if (et && et.length > 0) return etRaw;

    if (drop) {
      if (typeof etRaw === "string" || typeof tRaw === "string") drop.empty_text++;
      else drop.missing_text++;
    }
    return null;
  };

  // 1. Extract keywords from recent messages (for duplicate filtering).
  const recentKeywords = recentMessages
    ? extractKeywordsFromMessages(recentMessages)
    : new Set();
  const recentKeywordsCount = recentKeywords?.size || 0;

  // 2. Filter RAG contexts that duplicate recent messages.
  let filteredResults = results;
  const inputCount = Array.isArray(results) ? results.length : 0;
  const shouldApplyDedupe =
    recentKeywordsCount > 0 && Array.isArray(results) && results.length > 2;
  let dedupe = {
    applied: false,
    reverted: false,
    originalCount: inputCount,
    afterCount: inputCount,
    recentKeywordsCount,
    note: "skip when results <= 2 to avoid emptying context"
  };
  if (shouldApplyDedupe) {
    const deduped = filterDuplicateRagContext(results, recentKeywords);
    dedupe = {
      ...dedupe,
      applied: true,
      afterCount: Array.isArray(deduped) ? deduped.length : 0
    };

    // ✅ Safety: If duplicate filter results in zero, use original results.
    // (Especially when results are few, duplicate removal can be too aggressive causing KB context to be empty.)
    if (!deduped || !Array.isArray(deduped) || deduped.length === 0) {
      filteredResults = results;
      dedupe.reverted = true;
      dedupe.afterCount = inputCount;
    } else {
      filteredResults = deduped;
    }
  }

  const filteredCount = Array.isArray(filteredResults) ? filteredResults.length : 0;

  // 3. Filter Qdrant search results (tenant filter already applied, optional double check).
  const sliced = (Array.isArray(filteredResults) ? filteredResults : []).slice(
    0,
    MAX_CONTEXT_CHUNKS
  );

  const drop = {
    missing_payload: 0,
    missing_text: 0,
    empty_text: 0,
    tenant_mismatch: 0,
    missing_tenant: 0
  };

  const validResults = [];
  for (const r of sliced) {
    const payload = r?.payload;
    if (!payload) {
      drop.missing_payload++;
      continue;
    }

    const text = pickContextText(payload, drop);
    if (typeof text !== "string") {
      continue;
    }

    // Tenant field may or may not exist. If present, double check ignoring case.
    const payloadTenantRaw = payload.tenant;
    if (payloadTenantRaw == null || String(payloadTenantRaw).trim().length === 0) {
      drop.missing_tenant++;
      validResults.push(r);
      continue;
    }
    const payloadTenant = String(payloadTenantRaw).toLowerCase();
    if (normalizedTenantId && payloadTenant !== normalizedTenantId) {
      drop.tenant_mismatch++;
      continue;
    }
    validResults.push(r);
  }

  if (validResults.length === 0) {
    return {
      ragContext: "",
      debug: {
        inputCount,
        filteredCount,
        slicedCount: sliced.length,
        validCount: 0,
        dedupe,
        drop
      }
    };
  }

  // 4. Extract data directly from Qdrant payload (no Firestore lookup needed).
  const contextParts = [];

  for (const result of validResults) {
    const payload = result.payload || {};
    const text = pickContextText(payload, null);

    if (!text) continue; // Skip if text is missing.

    // Text formatting (still needed: apply MAX_CONTEXT_CHARS_EACH).
    const formattedText = formatRowDataForContext(
      { text },
      MAX_CONTEXT_CHARS_EACH
    );

    if (formattedText) {
      // Source tags are not shown to users (to avoid model copying them into answers) → context includes only text.
      contextParts.push(formattedText);
    }
  }

  return {
    ragContext: contextParts.join("\n\n"),
    debug: {
      inputCount,
      filteredCount,
      slicedCount: sliced.length,
      validCount: validResults.length,
      dedupe,
      drop
    }
  };
}

// Export common formatting function (used in streamChatRag.js).
module.exports = {
  buildRagContextFromResults,
  formatRowDataForContext, // Export common formatting function.
  filterResultsByScore // Filtering function based on score
};