/**
 * ============================================================================
 * memoryCache.js - 메모리 캐시 관리 유틸리티
 * ============================================================================
 *
 * Firebase Functions 인스턴스 생명주기 동안 유지되는 메모리 캐시를 관리합니다.
 * 멀티테넌트 격리를 위해 모든 키는 `${tenant_id}:${resource_id}` 형식을 사용합니다.
 *
 * 캐시 종류:
 * 1. conversationCache: Chat과 Messages 캐시
 * 2. datasetCache: Dataset 문서 캐시
 * 3. promptCache: Prompt 문서 캐시
 * 4. tenantCache: Tenant 문서 캐시 (init 모드에서 사전 캐시)
 *
 * TTL: 10분 (CACHE_TTL_MS)
 * - conversationCache / tenantCache: TTL 기반 만료
 * - datasetCache / promptCache: 가능하면 tenant 메타(updated_at/version) 기반으로 항상 검증(=TTL 무력화),
 *   tenant 메타가 없을 때만 TTL로 방어(무한 스테일 방지)
 * - 전역·조합 프롬프트만 1일 (PROMPT_CACHE_TTL_MS)
 * ============================================================================
 */

const CACHE_TTL_MS = 10 * 60 * 1000; // 10분 (conversation, dataset, prompt, tenant)
const PROMPT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1일 (전역 프롬프트, 조합 프롬프트)

// ============================================================================
// Init 모드 캐시 정리(찌꺼기 제거) 설정
// - init 요청에서만 제한된 budget으로 정리 (응답 지연/비용 상한을 쉽게 제어)
// - 운영 중 쉽게 조정할 수 있도록 const로 노출
// ============================================================================
const INIT_CACHE_CLEANUP_BUDGET = 10; // init 1회당 최대 정리할 tenant 수
const INIT_CACHE_CLEANUP_STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 이 시간보다 오래된 tenant는 stale로 간주 (기본 7일)
const INIT_CACHE_CLEANUP_SCAN_LIMIT = 5000; // tenantCache에서 최대 스캔 개수 (정렬/전체스캔 방지)
const INIT_CACHE_CLEANUP_CANDIDATE_CAP_MULTIPLIER = 5; // budget * n 만큼만 후보 수집 후 정렬
const INIT_CACHE_CLEANUP_MIN_INTERVAL_MS = 60 * 1000; // 인스턴스별 최소 실행 간격(너무 자주 돌지 않게)
let lastInitCleanupAt = 0;

// ============================================================================
// 타임스탬프 정규화 함수
// Firestore Timestamp 객체 또는 숫자(밀리초)를 일관된 숫자로 변환
// ============================================================================
function normalizeTimestamp(ts) {
  if (ts === null || ts === undefined) return null;
  if (typeof ts === 'number') return ts;
  if (ts.toMillis) return ts.toMillis(); // Firestore Timestamp
  if (ts._seconds) return ts._seconds * 1000; // Firestore Timestamp (raw)
  if (ts instanceof Date) return ts.getTime();
  return null;
}

// ============================================================================
// 메모리 캐시 Map 인스턴스
// ============================================================================
const conversationCache = new Map();
const datasetCache = new Map();
const promptCache = new Map();
const tenantCache = new Map();

// ============================================================================
// 캐시 키 생성 함수
// ============================================================================
function getCacheKey(tenantId, conversationId) {
  return `${tenantId}:${conversationId}`;
}

function getDatasetCacheKey(tenantId, datasetId) {
  return `${tenantId}:${datasetId}`;
}

function getPromptCacheKey(tenantId, promptId) {
  return `${tenantId}:${promptId}`;
}

function getTenantCacheKey(tenantId) {
  return tenantId;
}

// ============================================================================
// Conversation 캐시 함수
// ============================================================================
function getCachedConversation(tenantId, conversationId) {
  const key = getCacheKey(tenantId, conversationId);
  const cached = conversationCache.get(key);
  if (!cached) return null;

  // TTL 체크 (10분)
  const cacheAge = Date.now() - cached.lastUpdated;
  if (cacheAge > CACHE_TTL_MS) {
    // 만료: 삭제는 하지 않지만, 호출부가 Firestore를 다시 읽도록 null 반환
    return null;
  }

  return cached;
}

function setCachedConversation(tenantId, conversationId, chat, messages) {
  const key = getCacheKey(tenantId, conversationId);
  conversationCache.set(key, {
    chat,
    messages,
    lastUpdated: Date.now()
  });
}

// ============================================================================
// Dataset 캐시 함수
// ============================================================================
/**
 * Dataset 캐시의 용도:
 *
 * 1. Dataset 필터링 (Dataset Similarity Filtering)
 *    - targetDatasets가 3개 이상일 때, 각 dataset의 embed_value와 질문 임베딩을 비교
 *    - 코사인 유사도를 계산하여 관련 있는 dataset만 선택
 *    - RAG 검색 성능 최적화 (불필요한 dataset 검색 방지)
 *
 * 2. 비용 절감
 *    - Dataset 문서는 자주 변경되지 않으므로 메모리 캐시로 반복 Firestore 읽기 방지
 *    - Firestore 읽기 비용 절감 및 응답 속도 향상
 *
 * 3. 변경 감지
 *    - tenant 객체(메모리)의 datasets_metadata[datasetId].updated_at과 비교
 *    - 타임스탬프가 다르면 캐시 무효화하여 최신 데이터 보장
 *
 * 캐시 동작 흐름:
 * 1. filterDatasetsBySimilarity() 호출
 * 2. getCachedDatasets()로 메모리 캐시 확인
 * 3. 캐시에 있으면 → 바로 사용 (Firestore 읽기 생략)
 * 4. 캐시에 없으면 → Firestore에서 읽고 캐시에 저장
 * 5. 각 dataset의 embed_value와 질문 임베딩 비교
 * 6. 유사도 높은 dataset만 선택
 *
 * TTL: 10분 (CACHE_TTL_MS)
 * TTL 만료 후에도 tenant 객체의 datasets_metadata[datasetId].updated_at이 같으면 캐시 재사용 (TTL 갱신)
 */
function getCachedDataset(tenantId, datasetId, tenantData = null) {
  const key = getDatasetCacheKey(tenantId, datasetId);
  const cached = datasetCache.get(key);
  if (!cached) return null;

  // ✅ 변경: dataset은 "기준 정보"이므로, 가능하면 매 요청마다 tenant 메타(updated_at)로 변경 여부를 검증해 계속 유지.
  // - tenant 메타가 있으면 TTL(10분)과 무관하게 비교
  // - tenant 메타가 없으면 기존 TTL로 방어
  if (tenantData?.datasets_metadata?.[datasetId]) {
    const tenantDatasetMeta = tenantData.datasets_metadata[datasetId];
    const cachedTimestamp = normalizeTimestamp(cached.updated_at);
    const tenantTimestamp = normalizeTimestamp(tenantDatasetMeta.updated_at);

    if (tenantTimestamp !== null && cachedTimestamp !== null && tenantTimestamp === cachedTimestamp) {
      // 변경 없음 → 재사용 (접근 시각 갱신)
      cached.lastUpdated = Date.now();
      return cached;
    }
    // 변경됨(또는 비교 불가) → 무효화
    datasetCache.delete(key);
    return null;
  }

  const cacheAge = Date.now() - cached.lastUpdated;

  if (cacheAge > CACHE_TTL_MS) {
    // tenant 메타가 없으면 TTL 이후에는 다시 로드하도록 null 반환 (삭제는 하지 않음)
    return null;
  }

  return cached;
}

function setCachedDataset(tenantId, datasetId, data, timestamp = null) {
  const key = getDatasetCacheKey(tenantId, datasetId);
  // timestamp가 제공되지 않으면 data에서 자동 추출 (updated_at 우선, 없으면 created_at)
  // 정규화하여 숫자(밀리초)로 저장
  const rawTimestamp = timestamp !== null
    ? timestamp
    : (data?.updated_at || data?.created_at || null);
  const finalTimestamp = normalizeTimestamp(rawTimestamp);

  datasetCache.set(key, {
    data,
    updated_at: finalTimestamp,
    lastUpdated: Date.now()
  });
}

/**
 * 여러 Dataset 문서를 캐시에서 가져오기 (없으면 null 반환)
 * 반환값은 Firestore DocumentSnapshot과 호환되는 형태
 * @param {string} tenantId - 테넌트 ID
 * @param {string[]} datasetIds - Dataset ID 배열
 * @param {object} tenantData - Tenant 문서 데이터 (메타데이터 포함)
 */
function getCachedDatasets(tenantId, datasetIds, tenantData = null) {
  const results = [];
  const missingIds = [];

  for (let i = 0; i < datasetIds.length; i++) {
    const datasetId = datasetIds[i];
    const cached = getCachedDataset(tenantId, datasetId, tenantData);
    if (cached) {
      // Firestore DocumentSnapshot과 호환되는 형태로 반환
      results[i] = {
        exists: true,
        data: () => cached.data,
        id: datasetId
      };
    } else {
      results[i] = null;
      missingIds.push(datasetId);
    }
  }

  return { results, missingIds };
}

// ============================================================================
// Prompt 캐시 함수
// ============================================================================
function getPromptTimestamp(data) {
  // 정규화하여 숫자(밀리초)로 반환
  return normalizeTimestamp(data?.updated_at || data?.created_at || null);
}

function getCachedPrompt(tenantId, promptId, tenantData = null) {
  if (!promptId) return null;
  const key = getPromptCacheKey(tenantId, promptId);
  const cached = promptCache.get(key);
  if (!cached) return null;

  // ✅ 변경: prompt는 "기준 정보"이므로, 가능하면 매 요청마다 tenant 메타(version/updated_at)로 변경 여부를 검증해 계속 유지.
  // - tenant 메타가 있으면 TTL(10분)과 무관하게 비교
  // - tenant 메타가 없으면 기존 TTL로 방어
  if (tenantData?.prompt_metadata) {
    const tenantPromptMeta = tenantData.prompt_metadata;
    const cachedTimestamp = normalizeTimestamp(cached.updated_at);
    const tenantTimestamp = normalizeTimestamp(tenantPromptMeta.updated_at);
    const tenantVersion = tenantPromptMeta.version || 0;
    const cachedVersion = cached.data?.tenant_version || 0;

    // tenant_version 우선, 없으면 updated_at 비교
    const sameByVersion = tenantVersion > 0 && tenantVersion === cachedVersion;
    const sameByTimestamp =
      tenantVersion === 0 &&
      tenantTimestamp !== null &&
      cachedTimestamp !== null &&
      tenantTimestamp === cachedTimestamp;

    if (sameByVersion || sameByTimestamp) {
      cached.cachedAt = Date.now(); // 접근 시각 갱신
      return cached;
    }

    // 변경됨 → 무효화
    promptCache.delete(key);
    return null;
  }

  const cacheAge = Date.now() - cached.cachedAt;

  if (cacheAge > CACHE_TTL_MS) {
    // tenant 메타가 없으면 TTL 이후에는 다시 로드하도록 null 반환 (삭제는 하지 않음)
    return null;
  }

  return cached;
}

function setCachedPrompt(tenantId, promptId, data, timestamp = null) {
  if (!promptId) return;
  const key = getPromptCacheKey(tenantId, promptId);
  // timestamp가 제공되지 않으면 data에서 자동 추출 (updated_at 우선, 없으면 created_at)
  // getPromptTimestamp가 이미 정규화하므로 그대로 사용
  const finalTimestamp =
      timestamp !== null ? normalizeTimestamp(timestamp) : getPromptTimestamp(data);
  promptCache.set(key, {
    data,
    updated_at: finalTimestamp, // 정규화된 숫자(밀리초)
    cachedAt: Date.now() // 캐시 저장 시점 (로깅용)
  });
}

function deleteCachedPrompt(tenantId, promptId) {
  if (!promptId) return;
  const key = getPromptCacheKey(tenantId, promptId);
  promptCache.delete(key);
}

// ============================================================================
// 전역 프롬프트 캐시 함수
// ============================================================================
const globalPromptCache = new Map();
const GLOBAL_PROMPT_KEY = "_global:system_prompt";

function getCachedGlobalPrompt(currentUpdatedAt = null) {
  const cached = globalPromptCache.get(GLOBAL_PROMPT_KEY);
  if (!cached) return null;

  // TTL 체크 (1일)
  const cacheAge = Date.now() - cached.cachedAt;
  if (cacheAge > PROMPT_CACHE_TTL_MS) {
    // TTL이 지났으면 updated_at 비교
    // 타임스탬프 정규화 (Timestamp 객체 또는 숫자 모두 처리)
    const normalizedCurrent = normalizeTimestamp(currentUpdatedAt);
    const normalizedCached = normalizeTimestamp(cached.updated_at);
    if (normalizedCurrent !== null && normalizedCached !== null) {
      if (normalizedCached === normalizedCurrent) {
        // updated_at이 같으면 캐시 재사용 (TTL 갱신)
        cached.cachedAt = Date.now();
        return cached;
      } else {
        // updated_at이 다르면 캐시 무효화
        globalPromptCache.delete(GLOBAL_PROMPT_KEY);
        return null;
      }
    } else {
      // updated_at 정보가 없으면 캐시 무효화
      globalPromptCache.delete(GLOBAL_PROMPT_KEY);
      return null;
    }
  }

  // TTL 내에 있어도 updated_at이 다르면 무효화
  const normalizedCurrent = normalizeTimestamp(currentUpdatedAt);
  const normalizedCached = normalizeTimestamp(cached.updated_at);
  if (normalizedCurrent !== null && normalizedCached !== null) {
    if (normalizedCached !== normalizedCurrent) {
      globalPromptCache.delete(GLOBAL_PROMPT_KEY);
      return null;
    }
  }

  return cached;
}

function setCachedGlobalPrompt(text, version, updatedAt = null) {
  globalPromptCache.set(GLOBAL_PROMPT_KEY, {
    text,
    version,
    updated_at: normalizeTimestamp(updatedAt), // 정규화된 숫자(밀리초) 저장
    cachedAt: Date.now()
  });
}

// ============================================================================
// 조합된 시스템 프롬프트 캐시 함수
// ============================================================================
const combinedPromptCache = new Map();

function getCombinedPromptCacheKey(tenantId, globalVersion, tenantVersion) {
  return `${tenantId}:${globalVersion}:${tenantVersion}`;
}

function getCachedCombinedPrompt(tenantId, globalVersion, tenantVersion) {
  const key = getCombinedPromptCacheKey(tenantId, globalVersion, tenantVersion);
  const cached = combinedPromptCache.get(key);
  if (!cached) return null;

  // TTL 체크 (1일)
  const cacheAge = Date.now() - cached.cachedAt;
  if (cacheAge > PROMPT_CACHE_TTL_MS) {
    combinedPromptCache.delete(key);
    return null;
  }

  return cached;
}

function setCachedCombinedPrompt(tenantId, globalVersion, tenantVersion, combinedPrompt) {
  const key = getCombinedPromptCacheKey(tenantId, globalVersion, tenantVersion);
  combinedPromptCache.set(key, {
    combinedPrompt,
    cachedAt: Date.now()
  });
}

// ============================================================================
// Tenant 캐시 함수
// ============================================================================
/**
 * Tenant 캐시의 용도:
 *
 * 1. Init 모드 최적화
 *    - 클라이언트가 화면 접속 시 init 모드로 tenant 정보를 사전 캐시
 *    - 이후 실제 메시지 요청 시 Firestore 읽기 제거
 *
 * 2. 성능 향상
 *    - Tenant 문서는 자주 변경되지 않으므로 메모리 캐시로 반복 Firestore 읽기 방지
 *    - Firestore 읽기 비용 절감 및 응답 속도 향상 (10-50ms 개선)
 *
 * 3. Usage 필드 누적 특성 활용
 *    - usage 필드는 누적 개념이므로 TTL(10분)로 안전하게 캐시 가능
 *    - billing window 초기화는 한 달에 한 번 정도만 발생
 *
 * 캐시 동작 흐름:
 * 1. Init 모드에서 tenant 로드 및 캐시 (billing window 포함)
 * 2. 일반 모드에서 getCachedTenant()로 캐시 확인
 * 3. 캐시에 있으면 → 바로 사용 (Firestore 읽기 생략)
 * 4. 캐시에 없으면 → Firestore에서 읽고 캐시에 저장
 *
 * TTL: 10분 (CACHE_TTL_MS)
 */
function getCachedTenant(tenantId) {
  const key = getTenantCacheKey(tenantId);
  const cached = tenantCache.get(key);
  if (!cached) return null;

  // TTL 체크 (10분)
  const cacheAge = Date.now() - cached.lastUpdated;
  if (cacheAge > CACHE_TTL_MS) {
    // 만료: 삭제는 하지 않지만, 호출부가 Firestore를 다시 읽도록 null 반환
    return null;
  }

  return cached.data;
}

function setCachedTenant(tenantId, tenantData) {
  const key = getTenantCacheKey(tenantId);
  tenantCache.set(key, {
    data: tenantData,
    lastUpdated: Date.now()
  });
}

function deleteCachedTenant(tenantId) {
  const key = getTenantCacheKey(tenantId);
  tenantCache.delete(key);
}

// ============================================================================
// Init 모드 캐시 정리 (tenant 단위로 5개 캐시를 함께 정리)
// - tenantCache.lastUpdated 기준으로 stale tenant를 선정
// - 선정된 tenant에 대해 conversation/dataset/prompt/combined 캐시도 prefix로 함께 삭제
// - 메트릭을 반환하여 호출부에서 "8/10" 및 감소율(%) 등을 로깅할 수 있게 함
// ============================================================================
function cleanupStaleTenantsOnInit(nowMs = Date.now(), options = {}) {
  const budget = Number.isFinite(options.budget) ? options.budget : INIT_CACHE_CLEANUP_BUDGET;
  const staleWindowMs = Number.isFinite(options.staleWindowMs)
    ? options.staleWindowMs
    : INIT_CACHE_CLEANUP_STALE_WINDOW_MS;
  const scanLimit = Number.isFinite(options.scanLimit)
    ? options.scanLimit
    : INIT_CACHE_CLEANUP_SCAN_LIMIT;
  const minIntervalMs = Number.isFinite(options.minIntervalMs)
    ? options.minIntervalMs
    : INIT_CACHE_CLEANUP_MIN_INTERVAL_MS;

  if (budget <= 0) {
    return { skipped: true, reason: "budget<=0" };
  }
  if (minIntervalMs > 0 && nowMs - lastInitCleanupAt < minIntervalMs) {
    return {
      skipped: true,
      reason: "throttled",
      next_allowed_in_ms: minIntervalMs - (nowMs - lastInitCleanupAt),
    };
  }
  lastInitCleanupAt = nowMs;

  const before = {
    tenant: tenantCache.size,
    conversation: conversationCache.size,
    dataset: datasetCache.size,
    prompt: promptCache.size,
    combinedPrompt: combinedPromptCache.size,
  };
  const beforeTotal =
    before.tenant +
    before.conversation +
    before.dataset +
    before.prompt +
    before.combinedPrompt;

  const cap = Math.max(10, budget * INIT_CACHE_CLEANUP_CANDIDATE_CAP_MULTIPLIER);
  const candidates = [];
  let scannedTenantEntries = 0;

  for (const [tenantId, entry] of tenantCache.entries()) {
    scannedTenantEntries++;
    if (scannedTenantEntries > scanLimit) break;

    const lastUpdated = Number(entry?.lastUpdated || 0);
    if (!Number.isFinite(lastUpdated) || lastUpdated <= 0) continue;
    if (nowMs - lastUpdated < staleWindowMs) continue;

    candidates.push({ tenantId: String(tenantId), lastUpdated });
    if (candidates.length >= cap) break; // 비용 상한
  }

  candidates.sort((a, b) => a.lastUpdated - b.lastUpdated);
  const selected = candidates.slice(0, budget);
  const staleTenantIds = new Set(selected.map((c) => c.tenantId));

  const deleted = {
    tenants: 0,
    conversation: 0,
    dataset: 0,
    prompt: 0,
    combinedPrompt: 0,
  };

  for (const tenantId of staleTenantIds) {
    if (tenantCache.delete(tenantId)) deleted.tenants++;
  }

  if (staleTenantIds.size > 0) {
    for (const key of conversationCache.keys()) {
      const tenantPrefix = String(key).split(":", 1)[0];
      if (staleTenantIds.has(tenantPrefix)) {
        conversationCache.delete(key);
        deleted.conversation++;
      }
    }
    for (const key of datasetCache.keys()) {
      const tenantPrefix = String(key).split(":", 1)[0];
      if (staleTenantIds.has(tenantPrefix)) {
        datasetCache.delete(key);
        deleted.dataset++;
      }
    }
    for (const key of promptCache.keys()) {
      const tenantPrefix = String(key).split(":", 1)[0];
      if (staleTenantIds.has(tenantPrefix)) {
        promptCache.delete(key);
        deleted.prompt++;
      }
    }
    for (const key of combinedPromptCache.keys()) {
      const tenantPrefix = String(key).split(":", 1)[0];
      if (staleTenantIds.has(tenantPrefix)) {
        combinedPromptCache.delete(key);
        deleted.combinedPrompt++;
      }
    }
  }

  const after = {
    tenant: tenantCache.size,
    conversation: conversationCache.size,
    dataset: datasetCache.size,
    prompt: promptCache.size,
    combinedPrompt: combinedPromptCache.size,
  };
  const afterTotal =
    after.tenant +
    after.conversation +
    after.dataset +
    after.prompt +
    after.combinedPrompt;

  const reduced = beforeTotal - afterTotal;
  const reducedPct = beforeTotal > 0 ? (reduced / beforeTotal) * 100 : 0;

  return {
    skipped: false,
    budget,
    deleted_tenants: deleted.tenants,
    deleted_ratio: `${deleted.tenants}/${budget}`,
    stale_window_ms: staleWindowMs,
    scanned_tenant_entries: scannedTenantEntries,
    candidates_found: candidates.length,
    deleted_entries: deleted,
    before,
    after,
    before_total: beforeTotal,
    after_total: afterTotal,
    reduced_total: reduced,
    reduced_pct: Number(reducedPct.toFixed(1)),
  };
}

module.exports = {
  // Conversation 캐시
  getCachedConversation,
  setCachedConversation,

  // 타임스탬프 정규화 함수
  normalizeTimestamp,

  // Dataset 캐시
  getCachedDataset,
  setCachedDataset,
  getCachedDatasets,

  // Prompt 캐시
  getCachedPrompt,
  setCachedPrompt,
  getPromptTimestamp,
  deleteCachedPrompt,

  // 전역 프롬프트 캐시
  getCachedGlobalPrompt,
  setCachedGlobalPrompt,

  // 조합된 프롬프트 캐시
  getCachedCombinedPrompt,
  setCachedCombinedPrompt,

  // Tenant 캐시
  getCachedTenant,
  setCachedTenant,
  deleteCachedTenant,

  // Init 모드 캐시 정리
  cleanupStaleTenantsOnInit,

  // 상수
  CACHE_TTL_MS,
  PROMPT_CACHE_TTL_MS,
  INIT_CACHE_CLEANUP_BUDGET,
  INIT_CACHE_CLEANUP_STALE_WINDOW_MS,
  INIT_CACHE_CLEANUP_SCAN_LIMIT,
  INIT_CACHE_CLEANUP_MIN_INTERVAL_MS
};