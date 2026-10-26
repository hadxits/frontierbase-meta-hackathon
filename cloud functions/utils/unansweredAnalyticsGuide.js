/**
 * analytics_unanswered 레코드 + GCS evidence.json을 LLM으로 분석해 개선 가이드 생성
 * Evidence는 분석 시 10분 signed URL → OpenAI input_file.file_url (GCS 내용 그대로)
 */
const OpenAI = require("openai");
const { toFile } = require("openai");
const environment = require("@/env");
const { AppConfig } = require("@/const/AppConfig");
const { store, storage } = require("@/firebase");
const Collection = require("@/const/firestore/Collection");
const ApiError = require("@/errors/apiError");
const { getLocalizedErrorMessage } = require("@/utils/localization");
const { logWarn } = require("@/utils/logger");
const { retryOnceOn429 } = require("@/utils/retry");
const checkTokenLimit = require("@/utils/checkTokenLimit");
const updateTokenUsage = require("@/utils/updateTokenUsage");

const OPENAI_LITE_MODEL = AppConfig.DEFAULT_OPENAI_LITE_MODEL;
const EVIDENCE_FILENAME = "evidence.json";
const SIGNED_URL_EXPIRY_MINUTES = 10;
const OPENAI_FILE_EXPIRE_SECONDS = 3600;
const LLM_TIMEOUT_MS = 120000;
const MAX_OUTPUT_TOKENS = 4096;
const ANALYSIS_GUIDE_MAX_CHARS = 50000;

let openAIInstance = null;

function getOpenAI() {
  if (!openAIInstance) {
    const apiKey = environment.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    openAIInstance = new OpenAI({ apiKey });
  }
  return openAIInstance;
}

function normalizeLocale(locale) {
  const raw = String(locale || "").trim().toLowerCase();
  if (!raw) return "en";
  return raw.split(/[-_]/)[0] || "en";
}

function parseGsPath(gcsPath) {
  const match = String(gcsPath || "")
    .trim()
    .match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], filePath: match[2] };
}

async function createEvidenceSignedReadUrl(gcsPath) {
  const parsed = parseGsPath(gcsPath);
  if (!parsed) {
    return { signedUrl: null, expiresAt: null, error: "invalid_gcs_path" };
  }

  const file = storage.bucket(parsed.bucket).file(parsed.filePath);
  const [exists] = await file.exists();
  if (!exists) {
    return { signedUrl: null, expiresAt: null, error: "evidence_not_found" };
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_MINUTES * 60 * 1000);
  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: expiresAt,
    queryParams: {
      "response-content-type": "application/json"
    }
  });

  return {
    signedUrl,
    expiresAt: expiresAt.getTime(),
    error: null
  };
}

function resolveResponseLanguage(locale) {
  const map = {
    ko: "Korean",
    en: "English",
    ja: "Japanese",
    de: "German",
    fr: "French",
    it: "Italian",
    zh: "Chinese",
    es: "Spanish"
  };
  return map[normalizeLocale(locale)] || "English";
}

const SECTION_TITLES = {
  ko: {
    diagnosis: "실패 원인",
    gaps: "부족한 내용",
    actions: "개선 방법",
    priority: "우선 적용할 내용"
  },
  en: {
    diagnosis: "Why the answer failed",
    gaps: "What is missing",
    actions: "What to improve",
    priority: "What to do first"
  }
};

function getSectionTitles(locale) {
  const key = normalizeLocale(locale);
  return SECTION_TITLES[key] || SECTION_TITLES.en;
}

function describeFailureType(ragResultType, locale) {
  const type = String(ragResultType || "").trim().toLowerCase();
  const ko = {
    clarify: "질문이 모호해 추가 설명을 요청함",
    abstain: "관련 내용을 찾았지만 답변을 제공하지 못함",
    no_result: "관련 문서를 찾지 못함",
    no_datasets: "검색할 데이터가 없음",
    empty_context: "검색 결과가 비어 있음"
  };
  const en = {
    clarify: "Asked the user for more detail",
    abstain: "Found related content but could not answer",
    no_result: "No matching documents found",
    no_datasets: "No datasets available to search",
    empty_context: "Search returned no usable content"
  };
  const map = normalizeLocale(locale) === "ko" ? ko : en;
  return map[type] || (normalizeLocale(locale) === "ko" ? "답변 실패" : "Answer failed");
}

function buildAnalysisInstructions(responseLanguage, responseLocale) {
  const sections = getSectionTitles(responseLocale);
  return `You help a business user improve their chatbot knowledge base after a failed answer.
The reader is NOT a developer. Write in plain, direct ${responseLanguage}.

OUTPUT FORMAT (mandatory):
- Use exactly four sections as Markdown level-2 headings on their own lines: ## ${sections.diagnosis}, ## ${sections.gaps}, ## ${sections.actions}, ## ${sections.priority}
- Put a blank line after each heading, then bullet points (- ).
- Do NOT put subtitles or explanations on the same line as a heading.
- Do NOT use em dashes (—) in headings.
- Do NOT add a separate summary section at the end.

CONTENT RULES:
- Explain why the bot failed in everyday language.
- Refer to documents by topic, category, or a short quote from their text — never by internal IDs.
- When suggesting edits, say which topic/document to add or update (e.g. "기능 소개 문서", "시작하기 > 기능 가이드").
- For new content, say "새 문서 추가" or "new document" — do not invent ID strings.

FORBIDDEN in the user-visible text (never mention):
Qdrant, vector, embedding, RAG, dataset_id, row_id, score, JSON, API, algorithm, ranking, abstain, retrieval, hit count, LLM, AI model, token.

TONE:
- Short sentences. No filler ("즉,", "요약:", "권장합니다", "고려해 보세요", "바람직합니다").
- Write like an internal ops note, not a consultant report.

Use the attached reference file (search results from that conversation) when present. If no file is attached, explain using the question and bot response only.
Keep under 2000 words.`;
}

function buildUserInstructionText(opts) {
  const { responseLocale, question, record, storedHitCount } = opts;

  return JSON.stringify(
    {
      response_locale: responseLocale,
      user_question: question,
      bot_response: String(record.assistant_response || "").slice(0, 4000),
      what_happened: describeFailureType(record.rag_result_type, responseLocale),
      matched_document_count: storedHitCount,
      note:
        storedHitCount > 0
          ? "Attached file lists documents the bot found for this question. Use document topics/text only — not internal fields."
          : "No documents were found for this question. Analyze using the question and bot response only."
    },
    null,
    2
  );
}

function createEmptyUsage() {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function mergeUsageFromResponse(into, response) {
  const u = response?.usage;
  if (!u || typeof u !== "object") return into;
  const prompt = Number(u.input_tokens ?? u.prompt_tokens) || 0;
  const completion = Number(u.output_tokens ?? u.completion_tokens) || 0;
  const total = Number(u.total_tokens) || prompt + completion;
  if (total <= 0) return into;
  into.prompt_tokens += prompt;
  into.completion_tokens += completion;
  into.total_tokens += total;
  return into;
}

function extractResponsesOutputText(response) {
  if (response?.output_text != null && String(response.output_text).trim()) {
    return String(response.output_text).trim();
  }
  const parts = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== "message") continue;
    for (const block of Array.isArray(item.content) ? item.content : []) {
      if (block?.type === "output_text" && block.text != null) {
        parts.push(String(block.text));
      }
    }
  }
  return parts.join("").trim();
}

/** LLM 출력에서 내부 용어·ID 노출을 줄이고 섹션 헤딩을 정규화 */
function polishGuideForEndUser(guide, locale) {
  const sections = getSectionTitles(locale);
  let text = String(guide || "").trim();
  if (!text) return text;

  const sectionPatterns = [
    {
      re: /^(?:#{1,3}\s*)?(?:실패\s*진단|failure\s*diagnosis)[^\n]*/gim,
      title: sections.diagnosis
    },
    {
      re: /^(?:#{1,3}\s*)?(?:갭\s*분석|gap\s*analysis)[^\n]*/gim,
      title: sections.gaps
    },
    {
      re: /^(?:#{1,3}\s*)?(?:레코드\s*변경[^\n]*|record\s*changes?[^\n]*)/gim,
      title: sections.actions
    },
    {
      re: /^(?:#{1,3}\s*)?(?:우선순위[^\n]*|priority[^\n]*)/gim,
      title: sections.priority
    },
    {
      re: /^요약\s*[:：][^\n]*/gim,
      title: null
    }
  ];

  for (const { re, title } of sectionPatterns) {
    text = text.replace(re, (match) => {
      if (title == null) return "";
      if (/^##\s/.test(match.trim())) return `## ${title}`;
      return `## ${title}`;
    });
  }

  text = text
    .replace(/\b(row_id|dataset_id|score)\s*[:：]\s*["']?[^\s,"'\n]+["']?/gi, "")
    .replace(/\bQdrant\b/gi, "")
    .replace(/\babstain\b/gi, "")
    .replace(/\bretrieval hits?\b/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function formatOpenAIError(error) {
  if (!error) return "unknown";
  const parts = [error.message || String(error)];
  if (error.status != null) parts.push(`status=${error.status}`);
  if (error.code) parts.push(`code=${error.code}`);
  if (error.error?.message) parts.push(`api=${error.error.message}`);
  return parts.join(" | ");
}

async function uploadEvidenceOpenAIFile(openai, gcsPath) {
  const parsed = parseGsPath(gcsPath);
  if (!parsed) {
    throw new Error("invalid_gcs_path");
  }
  const file = storage.bucket(parsed.bucket).file(parsed.filePath);
  const [buffer] = await file.download();
  const uploaded = await openai.files.create({
    file: await toFile(buffer, EVIDENCE_FILENAME, { type: "application/json" }),
    purpose: "assistants",
    expires_after: {
      anchor: "created_at",
      seconds: OPENAI_FILE_EXPIRE_SECONDS
    }
  });
  return uploaded.id;
}

async function deleteOpenAIFileQuiet(openai, fileId) {
  if (!fileId) return;
  try {
    await openai.files.delete(fileId);
  } catch (err) {
    logWarn("[analyzeUnansweredQuestion] OpenAI file cleanup failed", {
      function_name: "analyzeUnansweredQuestion",
      extra: {
        file_id: fileId,
        error: err?.message || String(err)
      }
    });
  }
}

async function callAnalysisLLM(openai, instructions, userContent) {
  return retryOnceOn429(() =>
    withTimeout(
      openai.responses.create({
        model: OPENAI_LITE_MODEL,
        instructions,
        input: [
          {
            role: "user",
            content: userContent
          }
        ],
        temperature: 0.2,
        max_output_tokens: MAX_OUTPUT_TOKENS
      }),
      LLM_TIMEOUT_MS,
      "Unanswered analysis LLM timed out"
    )
  );
}

async function saveAnalysisGuide(recordRef, guide, locale) {
  const trimmed = String(guide || "").trim();
  if (!trimmed) return;

  const nowMs = Date.now();
  await recordRef.update({
    analysis_guide: trimmed.slice(0, ANALYSIS_GUIDE_MAX_CHARS),
    analysis_guide_at: nowMs,
    analysis_guide_locale: normalizeLocale(locale),
    updated_at: nowMs
  });
}

/**
 * @param {{ tenantId: string, analyticsUnansweredId: string, locale: string, tenantData?: object }} opts
 * @returns {Promise<string>}
 */
async function analyzeUnansweredQuestionGuide(opts) {
  const { tenantId, analyticsUnansweredId, locale, tenantData } = opts || {};
  const responseLocale = normalizeLocale(locale);
  const responseLanguage = resolveResponseLanguage(responseLocale);
  const usage = createEmptyUsage();

  const recordRef = store
    .collection(Collection.TENANTS)
    .doc(tenantId)
    .collection(Collection.ANALYTICS_UNANSWERED)
    .doc(analyticsUnansweredId);
  const recordSnap = await recordRef.get();
  if (!recordSnap.exists) {
    throw new ApiError({
      errorCode: "ANALYTICS_UNANSWERED_NOT_FOUND",
      message: getLocalizedErrorMessage(
        responseLocale,
        "ANALYTICS_UNANSWERED_NOT_FOUND"
      ),
      httpStatusCode: 404,
      returnToUser: true
    });
  }

  const record = recordSnap.data() || {};
  const cachedGuide = String(record.analysis_guide || "").trim();
  if (cachedGuide) {
    return cachedGuide;
  }

  const quotaCheckResult = await checkTokenLimit(tenantId, {
    locale: responseLocale,
    tenantData
  });
  if (quotaCheckResult.exceeded) {
    throw new ApiError({
      errorCode: "QUOTA_EXCEEDED",
      message: getLocalizedErrorMessage(responseLocale, "QUOTA_EXCEEDED_TOKEN"),
      httpStatusCode: 429,
      returnToUser: true,
      details: quotaCheckResult.details
    });
  }

  const question = String(record.question || "").trim();
  if (!question) {
    throw new ApiError({
      errorCode: "INVALID_ANALYTICS_RECORD",
      message: getLocalizedErrorMessage(responseLocale, "INVALID_ANALYTICS_RECORD"),
      httpStatusCode: 400,
      returnToUser: true
    });
  }

  const retrievalHitCount = Number(record.retrieval_hit_count);
  const storedHitCount =
    Number.isFinite(retrievalHitCount) && retrievalHitCount >= 0
      ? retrievalHitCount
      : 0;
  const evidenceGcsPath =
    record.evidence_gcs_path != null
      ? String(record.evidence_gcs_path).trim() || null
      : null;

  if (storedHitCount > 0 && !evidenceGcsPath) {
    throw new ApiError({
      errorCode: "INVALID_ANALYTICS_RECORD",
      message: getLocalizedErrorMessage(responseLocale, "INVALID_ANALYTICS_RECORD"),
      httpStatusCode: 400,
      returnToUser: true
    });
  }

  const openai = getOpenAI();
  const userContent = [
    {
      type: "input_text",
      text: buildUserInstructionText({
        responseLocale,
        question,
        record,
        storedHitCount
      })
    }
  ];

  let openaiFileId = null;
  const instructions = buildAnalysisInstructions(responseLanguage, responseLocale);

  try {
    if (evidenceGcsPath) {
      const signed = await createEvidenceSignedReadUrl(evidenceGcsPath);
      if (signed.error || !signed.signedUrl) {
        throw new ApiError({
          errorCode: "INVALID_ANALYTICS_RECORD",
          message: getLocalizedErrorMessage(responseLocale, "INVALID_ANALYTICS_RECORD"),
          httpStatusCode: 400,
          returnToUser: true
        });
      }

      userContent.push({
        type: "input_file",
        file_url: signed.signedUrl
      });
    }

    let resp;
    try {
      resp = await callAnalysisLLM(openai, instructions, userContent);
      mergeUsageFromResponse(usage, resp);
    } catch (fileUrlError) {
      if (!evidenceGcsPath) throw fileUrlError;

      logWarn("[analyzeUnansweredQuestion] file_url LLM failed, retrying with file upload", {
        tenant_id: tenantId,
        function_name: "analyzeUnansweredQuestion",
        extra: {
          analytics_unanswered_id: analyticsUnansweredId,
          error: formatOpenAIError(fileUrlError)
        }
      });

      userContent.pop();
      openaiFileId = await uploadEvidenceOpenAIFile(openai, evidenceGcsPath);
      userContent.push({
        type: "input_file",
        file_id: openaiFileId
      });
      resp = await callAnalysisLLM(openai, instructions, userContent);
      mergeUsageFromResponse(usage, resp);
    }

    let guide = extractResponsesOutputText(resp);
    guide = polishGuideForEndUser(guide, responseLocale);
    if (!guide) {
      throw new ApiError({
        errorCode: "ANALYSIS_FAILED",
        message: getLocalizedErrorMessage(responseLocale, "ANALYSIS_FAILED"),
        httpStatusCode: 502,
        returnToUser: true
      });
    }

    await saveAnalysisGuide(recordRef, guide, responseLocale);

    return guide;
  } finally {
    await deleteOpenAIFileQuiet(openai, openaiFileId);
    if (usage.total_tokens > 0) {
      await updateTokenUsage(tenantId, usage.total_tokens);
    }
  }
}

module.exports = {
  analyzeUnansweredQuestionGuide
};