/**
 * 벡터 검색 결과를 score 기준으로 분류하여 필터링
 * @param {Array} results - Qdrant 검색 결과 배열 [{ id, score, payload }, ...]
 * @param {Object} [options]
 * @param {number} [options.maxResults=10] - 최대 유지 개수 (컨텍스트 청크 수와 동일하게 맞추는 용도)
 * @param {number} [options.minScore=0.4] - 최소 score (Qdrant score_threshold와 맞추는 용도)
 * @returns {Array} - 필터링된 결과 배열
 *
 * 기존 tier 방식은 "상위 tier가 있으면 하위 tier를 전부 버리는" 구조라서,
 * 질의 분포에 따라 결과가 2개처럼 과도하게 줄어드는 문제가 발생할 수 있음.
 *
 * 따라서 **질문 유형에 대한 하드코딩 없이**, score 내림차순으로 정렬한 뒤
 * minScore 이상 결과를 maxResults까지 유지하는 단순한 정책으로 통일한다.
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
  // - dense 검색(score≈cosine)에서는 0.4 같은 임계값이 의미가 있음
  // - hybrid(RRF) 검색 score는 스케일이 달라 임계값을 쓰면 과도 필터링될 수 있음 → null이면 임계값 비활성화
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
// 공통 포맷팅 함수
// ============================================================================

/**
 * Row 데이터를 LLM 컨텍스트용 텍스트로 포맷팅
 * @param {Object} rowData - Firestore row 문서 데이터
 * @param {number} maxLength - 최대 길이 (기본값: 2000)
 * @returns {string} 포맷팅된 텍스트
 */
function formatRowDataForContext(rowData, maxLength = 2000) {
  if (!rowData) return "";

  let formattedText = "";

  // text 필드는 "key: value\nkey: value" 형식으로 저장됨
  if (rowData?.text) {
    let text = rowData.text;

    // 텍스트가 maxLength를 초과하면 줄 단위로 자르기
    if (text.length > maxLength) {
      const lines = text.split("\n");
      const truncatedLines = [];
      let currentLength = 0;

      for (const line of lines) {
        const lineLength = line.length + 1; // +1 for newline

        if (currentLength + lineLength > maxLength) {
          // 현재 줄을 추가하면 초과하므로 마지막 줄은 잘라서 추가
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
      // 텍스트가 충분히 짧으면 그대로 사용
      formattedText = text;
    }
  }

  return formattedText;
}

// ============================================================================
// RAG 컨텍스트 구성 함수
// ============================================================================

/**
 * 최근 메시지에서 키워드/엔티티 추출 (정규식 기반, LLM 사용 안 함 - 토큰 절감)
 * 다국어 지원: 한글, 영문, 일본어, 중국어, 독일어, 프랑스어, 이탈리아어 지원
 * 하드코딩된 stop words 없이 길이와 빈도 기반으로 의미있는 키워드만 추출
 * @param {Array} recentMessages - 최근 메시지 배열
 * @returns {Set<string>} - 추출된 키워드 집합
 */
function extractKeywordsFromMessages(recentMessages) {
  const keywordCounts = new Map(); // 키워드별 빈도 추적

  if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
    return new Set();
  }

  // 다국어 지원 정규식 패턴
  // - 한글: \uAC00-\uD7A3 (2자 이상)
  // - 영문: a-zA-Z (3자 이상)
  // - 일본어 히라가나: \u3040-\u309F (2자 이상)
  // - 일본어 가타카나: \u30A0-\u30FF (2자 이상)
  // - 일본어/중국어 한자: \u4E00-\u9FFF (1자 이상, 한자는 1자도 의미있음)
  // - 유럽 언어 (독일어/프랑스어/이탈리아어): a-zA-Z + 라틴 확장 문자 \u00C0-\u017F (3자 이상)
  const multilingualPattern = /[\uAC00-\uD7A3]{2,}|[a-zA-Z\u00C0-\u017F]{3,}|[\u3040-\u309F]{2,}|[\u30A0-\u30FF]{2,}|[\u4E00-\u9FFF]+/g;

  // 최근 메시지에서 키워드 추출 및 빈도 계산
  for (const msg of recentMessages) {
    const content = msg.content || "";
    if (!content || typeof content !== "string") continue;

    // 다국어 패턴으로 단어 추출
    const words = content.match(multilingualPattern) || [];

    words.forEach(word => {
      // 숫자만 있는 단어 제외
      if (/^\d+$/.test(word)) return;

      // 언어별 최소 길이 검증
      let isValidKeyword = false;
      let normalizedWord = word;

      // 한글: 2자 이상
      if (/[\uAC00-\uD7A3]/.test(word) && word.length >= 2) {
        isValidKeyword = true;
        normalizedWord = word.toLowerCase();
      }
      // 영문/유럽 언어: 3자 이상 (라틴 확장 문자 포함)
      else if (/[a-zA-Z\u00C0-\u017F]/.test(word) && word.length >= 3) {
        isValidKeyword = true;
        normalizedWord = word.toLowerCase();
      }
      // 일본어 히라가나: 2자 이상
      else if (/[\u3040-\u309F]/.test(word) && word.length >= 2) {
        isValidKeyword = true;
        normalizedWord = word; // 히라가나는 대소문자 구분 없음
      }
      // 일본어 가타카나: 2자 이상
      else if (/[\u30A0-\u30FF]/.test(word) && word.length >= 2) {
        isValidKeyword = true;
        normalizedWord = word; // 가타카나는 대소문자 구분 없음
      }
      // 일본어/중국어 한자: 1자 이상 (한자는 1자도 의미있음)
      else if (/[\u4E00-\u9FFF]/.test(word) && word.length >= 1) {
        isValidKeyword = true;
        normalizedWord = word; // 한자는 대소문자 구분 없음
      }

      if (isValidKeyword) {
        keywordCounts.set(normalizedWord, (keywordCounts.get(normalizedWord) || 0) + 1);
      }
    });
  }

  // 빈도가 2회 이상인 키워드만 반환 (의미있는 키워드만)
  // 단일 출현은 노이즈일 가능성이 높음
  const keywords = new Set();
  for (const [keyword, count] of keywordCounts.entries()) {
    if (count >= 2) {
      keywords.add(keyword);
    }
  }

  return keywords;
}

/**
 * RAG 컨텍스트에서 최근 메시지와 중복되는 정보 필터링
 * 정규식 기반 키워드 매칭 사용 (LLM 사용 안 함 - 토큰 절감)
 * 다국어 지원: 하드코딩 없이 키워드 매칭만 사용
 * @param {Array} results - Qdrant 검색 결과
 * @param {Set<string>} recentKeywords - 최근 메시지에서 추출한 키워드 (빈도 2회 이상)
 * @returns {Array} - 필터링된 결과
 */
function filterDuplicateRagContext(results, recentKeywords) {
  if (!recentKeywords || recentKeywords.size === 0) {
    return results; // 키워드가 없으면 필터링하지 않음
  }

  // 키워드가 너무 적으면 필터링하지 않음 (노이즈 방지)
  // 빈도 2회 이상인 키워드만 사용하므로 최소 3개 이상이어야 의미있음
  if (recentKeywords.size < 3) {
    return results;
  }

  // 각 결과의 텍스트에 최근 메시지 키워드가 많이 포함되어 있으면 제외
  const filtered = [];

  for (const result of results) {
    const text = result.payload?.text || "";
    if (!text) {
      filtered.push(result); // 텍스트가 없으면 포함
      continue;
    }

    const textLower = text.toLowerCase();
    let keywordMatchCount = 0;

    // 키워드 매칭 개수 계산 (단어 경계 고려, 다국어 지원)
    for (const keyword of recentKeywords) {
      // 정규식 이스케이프
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // 언어별 매칭 전략
      let regex;
      
      // 한글: 단어 경계 없음, 직접 포함 여부 확인
      if (/[\uAC00-\uD7A3]/.test(keyword)) {
        regex = new RegExp(escapedKeyword, 'i');
      }
      // 일본어 히라가나/가타카나: 단어 경계 없음, 직접 포함 여부 확인
      else if (/[\u3040-\u309F\u30A0-\u30FF]/.test(keyword)) {
        regex = new RegExp(escapedKeyword, 'i');
      }
      // 일본어/중국어 한자: 단어 경계 없음, 직접 포함 여부 확인
      else if (/[\u4E00-\u9FFF]/.test(keyword)) {
        regex = new RegExp(escapedKeyword, 'i');
      }
      // 영문/유럽 언어: 단어 경계 고려 (라틴 확장 문자 포함)
      else {
        regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
      }

      if (regex.test(textLower)) {
        keywordMatchCount++;
      }
    }

    // 키워드 매칭 비율 계산
    const matchRatio = keywordMatchCount / recentKeywords.size;

    // 매칭 비율이 낮으면 (25% 미만) 포함
    // 너무 많은 키워드가 매칭되면 최근 메시지에서 이미 언급된 정보일 가능성이 높음
    // 25% 임계값: 최근 메시지의 주요 키워드(빈도 2회 이상)가 RAG 컨텍스트에 많이 포함되면 중복으로 간주
    if (matchRatio < 0.25) {
      filtered.push(result);
    }
    // matchRatio >= 0.25이면 제외 (최근 메시지와 중복)
  }

  return filtered;
}

// ✅ 개선: Qdrant payload에 text/embedding_text와 version 저장으로 인한 대폭 간소화
// Firestore 조회 제거, 메모리 캐시 불필요, validateRecordRef 불필요 (Qdrant 필터로 이미 검증됨)
async function buildRagContextFromResults({
                                            results,
                                            tenant_id,
                                            MAX_CONTEXT_CHUNKS,
                                            MAX_CONTEXT_CHARS_EACH,
                                            recentMessages = null // 최근 메시지 (중복 필터링용)
                                          }) {
  const normalizedTenantId = String(tenant_id || "").toLowerCase();
  const pickContextText = (payload, drop) => {
    const tRaw = payload?.text;
    const etRaw = payload?.embedding_text;
    const t = typeof tRaw === "string" ? tRaw.trim() : null;
    const et = typeof etRaw === "string" ? etRaw.trim() : null;

    // 컨텍스트는 사람이 읽는 근거이므로 원문(text)을 우선 사용.
    // embedding_text는 라벨 제거로 검색 품질에 유리하지만, 답변 컨텍스트로는 정보 손실이 있을 수 있어 fallback으로만 사용.
    if (t && t.length > 0) return tRaw;
    if (et && et.length > 0) return etRaw;

    if (drop) {
      if (typeof etRaw === "string" || typeof tRaw === "string") drop.empty_text++;
      else drop.missing_text++;
    }
    return null;
  };

  // 1. 최근 메시지에서 키워드 추출 (중복 필터링용)
  const recentKeywords = recentMessages
    ? extractKeywordsFromMessages(recentMessages)
    : new Set();
  const recentKeywordsCount = recentKeywords?.size || 0;

  // 2. 최근 메시지와 중복되는 RAG 컨텍스트 필터링
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

    // ✅ 안전장치: 중복 필터가 결과를 0으로 만들면 원본 results를 사용
    // (특히 결과가 적을 때는 중복 제거가 과도하게 작동해 KB 컨텍스트가 비는 문제가 생김)
    if (!deduped || !Array.isArray(deduped) || deduped.length === 0) {
      filteredResults = results;
      dedupe.reverted = true;
      dedupe.afterCount = inputCount;
    } else {
      filteredResults = deduped;
    }
  }

  const filteredCount = Array.isArray(filteredResults) ? filteredResults.length : 0;

  // 3. Qdrant 검색 결과 필터링 (이미 tenant 필터 적용됨, 선택적 이중 검증)
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

    // tenant 필드는 있을 수도/없을 수도 있음. 있으면 이중 검증(대소문자 무시)
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

  // 4. Qdrant payload에서 직접 데이터 추출 (Firestore 조회 불필요)
  const contextParts = [];

  for (const result of validResults) {
    const payload = result.payload || {};
    const text = pickContextText(payload, null);

    if (!text) continue; // text가 없으면 건너뛰기

    // 텍스트 포맷팅 (여전히 필요: MAX_CONTEXT_CHARS_EACH 적용)
    const formattedText = formatRowDataForContext(
      { text },
      MAX_CONTEXT_CHARS_EACH
    );

    if (formattedText) {
      // 출처 태그는 사용자 노출 불필요(모델이 그대로 답변에 복사하는 부작용 발생) → 컨텍스트에는 텍스트만 포함
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

// 공통 포맷팅 함수 export (streamChatRag.js에서 사용)
module.exports = {
  buildRagContextFromResults,
  formatRowDataForContext, // 공통 포맷팅 함수 export
  filterResultsByScore // Score 기준 필터링 함수
};