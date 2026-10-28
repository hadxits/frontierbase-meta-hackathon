/**
 * Cloud Run ingest-worker only — multilingual messages for dataset document error field.
 * Separated from Cloud Functions localization.js; tenant language passed via DATASET_LOCALE env.
 *
 * Mapping scope (based on worker.js):
 * - Failures written to Firestore dataset.error: reason from main().catch, updateStatusToFailedAndCleanup, timeout, signal paths.
 * - The string patterns below are classified as dedicated phrases; other unknown API/runtime messages use WORKER_ERR_GENERIC.
 * - Concurrent indexing (another job / stuck) exits with code 0 without marking FAILED — not handled here.
 */

const SUPPORTED = new Set(["ko", "en", "ja", "de", "fr", "it", "zh", "es"]);

/**
 * @param {string} [raw]
 * @returns {string}
 */
function normalizeWorkerLocale(raw) {
  if (raw == null || typeof raw !== "string") return "en";
  const s = raw.trim().toLowerCase();
  if (!s) return "en";
  if (s.startsWith("ko") || s.includes("korean")) return "ko";
  if (s.startsWith("ja") || s.includes("japanese")) return "ja";
  if (s.startsWith("de") || s.includes("german")) return "de";
  if (s.startsWith("fr") || s.includes("french")) return "fr";
  if (s.startsWith("it") || s.includes("italian")) return "it";
  if (s.startsWith("zh") || s.includes("chinese")) return "zh";
  if (s.startsWith("es") || s.includes("spanish")) return "es";
  if (s.startsWith("en") || s.includes("english")) return "en";
  const two = s.slice(0, 2);
  if (SUPPORTED.has(two)) return two;
  return "en";
}

function applyTemplate(str, vars) {
  let out = str;
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.replaceAll(`{{${k}}}`, String(v));
  }
  return out;
}

/** @type {Record<string, Record<string, string>>} */
const MESSAGES = {
  WORKER_ERR_GENERIC: {
    ko: "데이터를 준비하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    en: "Something went wrong while preparing your data. Please try again later.",
    ja: "データの準備中に問題が発生しました。しばらくしてから再試行してください。",
    de: "Beim Vorbereiten Ihrer Daten ist ein Problem aufgetreten. Bitte versuchen Sie es später erneut.",
    fr: "Un probleme est survenu lors de la preparation de vos donnees. Veuillez reessayer plus tard.",
    it: "Si e verificato un problema durante la preparazione dei tuoi dati. Riprova piu tardi.",
    zh: "準備資料時發生問題，請稍後再試。",
    es: "Se produjo un problema al preparar tus datos. Intentalo de nuevo mas tarde."
  },
  WORKER_ERR_QDRANT_UNREACHABLE: {
    ko: "검색 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    en: "The search service is temporarily unavailable. Please try again later.",
    ja: "検索サービスに一時的に接続できません。しばらくしてから再試行してください。",
    de: "Der Suchdienst ist vorubergehend nicht verfugbar. Bitte versuchen Sie es spater erneut.",
    fr: "Le service de recherche est temporairement indisponible. Veuillez reessayer plus tard.",
    it: "Il servizio di ricerca e temporaneamente non disponibile. Riprova piu tardi.",
    zh: "搜尋服務暫時無法使用，請稍後再試。",
    es: "El servicio de busqueda no esta disponible temporalmente. Intentalo de nuevo mas tarde."
  },
  WORKER_ERR_QDRANT_HTTP: {
    ko: "데이터를 처리하는 중 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    en: "A temporary error occurred while processing your data. Please try again later.",
    ja: "データ処理中に一時的な問題が発生しました。しばらくしてから再試行してください。",
    de: "Bei der Verarbeitung Ihrer Daten ist ein vorubergehender Fehler aufgetreten. Bitte versuchen Sie es spater erneut.",
    fr: "Une erreur temporaire est survenue pendant le traitement de vos donnees. Veuillez reessayer plus tard.",
    it: "Si e verificato un errore temporaneo durante l'elaborazione dei tuoi dati. Riprova piu tardi.",
    zh: "處理資料時發生暫時性問題，請稍後再試。",
    es: "Se produjo un error temporal al procesar tus datos. Intentalo de nuevo mas tarde."
  },
  WORKER_ERR_QDRANT_VECTOR_COLLECTION: {
    ko: "현재 설정 문제로 데이터를 준비할 수 없습니다. 관리자에게 문의해 주세요.",
    en: "Your data couldn't be prepared because of a setup issue. Please contact support.",
    ja: "設定上の問題により、データを準備できませんでした。サポートへお問い合わせください。",
    de: "Ihre Daten konnten wegen eines Einrichtungsproblems nicht vorbereitet werden. Bitte wenden Sie sich an den Support.",
    fr: "Vos donnees n'ont pas pu etre preparees en raison d'un probleme de configuration. Veuillez contacter le support.",
    it: "Non e stato possibile preparare i tuoi dati a causa di un problema di configurazione. Contatta il supporto.",
    zh: "目前的設定有問題，無法準備資料。請聯絡支援團隊。",
    es: "No se pudieron preparar tus datos por un problema de configuracion. Ponte en contacto con soporte."
  },
  WORKER_ERR_QDRANT_SPARSE_MISSING: {
    ko: "현재 설정 문제로 데이터를 준비할 수 없습니다. 관리자에게 문의해 주세요.",
    en: "Your data couldn't be prepared because of a setup issue. Please contact support.",
    ja: "設定上の問題により、データを準備できませんでした。サポートへお問い合わせください。",
    de: "Ihre Daten konnten wegen eines Einrichtungsproblems nicht vorbereitet werden. Bitte wenden Sie sich an den Support.",
    fr: "Vos donnees n'ont pas pu etre preparees en raison d'un probleme de configuration. Veuillez contacter le support.",
    it: "Non e stato possibile preparare i tuoi dati a causa di un problema di configurazione. Contatta il supporto.",
    zh: "目前的設定有問題，無法準備資料。請聯絡支援團隊。",
    es: "No se pudieron preparar tus datos por un problema de configuracion. Ponte en contacto con soporte."
  },
  WORKER_ERR_EMBED_VECTOR_SIZE: {
    ko: "현재 설정 문제로 데이터를 준비할 수 없습니다. 관리자에게 문의해 주세요.",
    en: "Your data couldn't be prepared because of a setup issue. Please contact support.",
    ja: "設定上の問題により、データを準備できませんでした。サポートへお問い合わせください。",
    de: "Ihre Daten konnten wegen eines Einrichtungsproblems nicht vorbereitet werden. Bitte wenden Sie sich an den Support.",
    fr: "Vos donnees n'ont pas pu etre preparees en raison d'un probleme de configuration. Veuillez contacter le support.",
    it: "Non e stato possibile preparare i tuoi dati a causa di un problema di configurazione. Contatta il supporto.",
    zh: "目前的設定有問題，無法準備資料。請聯絡支援團隊。",
    es: "No se pudieron preparar tus datos por un problema de configuracion. Ponte en contacto con soporte."
  },
  WORKER_ERR_EMBEDDING_FAILED: {
    ko: "업로드한 파일에서 처리할 수 있는 내용을 충분히 찾지 못했습니다. 파일 내용을 확인한 뒤 다시 시도해 주세요.",
    en: "We couldn't find enough usable content in the uploaded file. Please check the file and try again.",
    ja: "アップロードしたファイルから処理できる内容を十分に見つけられませんでした。内容を確認して再試行してください。",
    de: "In der hochgeladenen Datei konnte nicht genug nutzbarer Inhalt gefunden werden. Bitte pruefen Sie die Datei und versuchen Sie es erneut.",
    fr: "Nous n'avons pas trouve assez de contenu exploitable dans le fichier televerse. Verifiez le fichier puis reessayez.",
    it: "Non abbiamo trovato abbastanza contenuto utilizzabile nel file caricato. Controlla il file e riprova.",
    zh: "上傳的檔案中沒有足夠可處理的內容。請檢查檔案後再試一次。",
    es: "No encontramos suficiente contenido utilizable en el archivo subido. Revisa el archivo y vuelve a intentarlo."
  },
  WORKER_ERR_EMBEDDING_SERVICE: {
    ko: "AI 처리 서비스가 일시적으로 원활하지 않습니다. 잠시 후 다시 시도해 주세요.",
    en: "The AI processing service is temporarily unavailable. Please try again later.",
    ja: "AI処理サービスが一時的に利用しづらい状態です。しばらくしてから再試行してください。",
    de: "Der KI-Verarbeitungsdienst ist vorubergehend nicht verfuegbar. Bitte versuchen Sie es spaeter erneut.",
    fr: "Le service de traitement IA est temporairement indisponible. Veuillez reessayer plus tard.",
    it: "Il servizio di elaborazione AI e temporaneamente non disponibile. Riprova piu tardi.",
    zh: "AI 處理服務暫時無法使用，請稍後再試。",
    es: "El servicio de procesamiento de IA no esta disponible temporalmente. Intentalo de nuevo mas tarde."
  },
  WORKER_ERR_GCS_INVALID_PATH: {
    ko: "업로드한 파일을 찾을 수 없습니다. 다시 업로드한 뒤 시도해 주세요.",
    en: "We couldn't find the uploaded file. Please upload it again and retry.",
    ja: "アップロードしたファイルが見つかりません。もう一度アップロードしてお試しください。",
    de: "Die hochgeladene Datei konnte nicht gefunden werden. Bitte laden Sie sie erneut hoch und versuchen Sie es noch einmal.",
    fr: "Nous n'avons pas trouve le fichier televerse. Veuillez le televerser a nouveau puis reessayer.",
    it: "Non abbiamo trovato il file caricato. Caricalo di nuovo e riprova.",
    zh: "找不到已上傳的檔案，請重新上傳後再試。",
    es: "No encontramos el archivo subido. Vuelve a subirlo y reintentalo."
  },
  WORKER_ERR_GCS_JSONL: {
    ko: "업로드한 파일을 읽을 수 없습니다. 파일 형식을 확인한 뒤 다시 시도해 주세요.",
    en: "We couldn't read the uploaded file. Please check the file format and try again.",
    ja: "アップロードしたファイルを読み取れませんでした。形式を確認して再試行してください。",
    de: "Die hochgeladene Datei konnte nicht gelesen werden. Bitte pruefen Sie das Format und versuchen Sie es erneut.",
    fr: "Nous n'avons pas pu lire le fichier televerse. Verifiez son format puis reessayez.",
    it: "Non siamo riusciti a leggere il file caricato. Controlla il formato e riprova.",
    zh: "無法讀取你上傳的檔案。請檢查檔案格式後再試。",
    es: "No pudimos leer el archivo subido. Revisa el formato e intentalo de nuevo."
  },
  WORKER_ERR_NO_VALID_ROWS: {
    ko: "업로드한 파일에서 사용할 수 있는 내용이 없습니다. 파일 내용을 확인해 주세요.",
    en: "No usable content was found in the uploaded file. Please check the file contents.",
    ja: "アップロードしたファイルに利用できる内容が見つかりませんでした。内容をご確認ください。",
    de: "In der hochgeladenen Datei wurde kein nutzbarer Inhalt gefunden. Bitte pruefen Sie den Dateiinhalt.",
    fr: "Aucun contenu exploitable n'a ete trouve dans le fichier televerse. Veuillez verifier son contenu.",
    it: "Nel file caricato non e stato trovato alcun contenuto utilizzabile. Controlla il contenuto del file.",
    zh: "上傳的檔案中找不到可用內容，請檢查檔案內容。",
    es: "No se encontro contenido utilizable en el archivo subido. Revisa su contenido."
  },
  WORKER_ERR_MISSING_ENV_TENANT: {
    ko: "서비스 설정 문제로 데이터를 처리할 수 없습니다. 관리자에게 문의해 주세요.",
    en: "Your data couldn't be processed because of a service setup issue. Please contact support.",
    ja: "サービス設定の問題により、データを処理できませんでした。サポートへお問い合わせください。",
    de: "Ihre Daten konnten wegen eines Service-Einrichtungsproblems nicht verarbeitet werden. Bitte wenden Sie sich an den Support.",
    fr: "Vos donnees n'ont pas pu etre traitees en raison d'un probleme de configuration du service. Veuillez contacter le support.",
    it: "Non e stato possibile elaborare i tuoi dati a causa di un problema di configurazione del servizio. Contatta il supporto.",
    zh: "因服務設定問題，無法處理你的資料。請聯絡支援團隊。",
    es: "No se pudieron procesar tus datos por un problema de configuracion del servicio. Ponte en contacto con soporte."
  },
  WORKER_ERR_MISSING_ENV_GCS: {
    ko: "업로드한 파일을 찾을 수 없습니다. 다시 업로드한 뒤 시도해 주세요.",
    en: "We couldn't find the uploaded file. Please upload it again and retry.",
    ja: "アップロードしたファイルが見つかりません。もう一度アップロードしてお試しください。",
    de: "Die hochgeladene Datei konnte nicht gefunden werden. Bitte laden Sie sie erneut hoch und versuchen Sie es noch einmal.",
    fr: "Nous n'avons pas trouve le fichier televerse. Veuillez le televerser a nouveau puis reessayer.",
    it: "Non abbiamo trovato il file caricato. Caricalo di nuovo e riprova.",
    zh: "找不到已上傳的檔案，請重新上傳後再試。",
    es: "No encontramos el archivo subido. Vuelve a subirlo y reintentalo."
  },
  WORKER_ERR_MISSING_ENV_OPENAI: {
    ko: "서비스 설정 문제로 데이터를 처리할 수 없습니다. 관리자에게 문의해 주세요.",
    en: "Your data couldn't be processed because of a service setup issue. Please contact support.",
    ja: "サービス設定の問題により、データを処理できませんでした。サポートへお問い合わせください。",
    de: "Ihre Daten konnten wegen eines Service-Einrichtungsproblems nicht verarbeitet werden. Bitte wenden Sie sich an den Support.",
    fr: "Vos donnees n'ont pas pu etre traitees en raison d'un probleme de configuration du service. Veuillez contacter le support.",
    it: "Non e stato possibile elaborare i tuoi dati a causa di un problema di configurazione del servizio. Contatta il supporto.",
    zh: "因服務設定問題，無法處理你的資料。請聯絡支援團隊。",
    es: "No se pudieron procesar tus datos por un problema de configuracion del servicio. Ponte en contacto con soporte."
  },
  WORKER_ERR_MISSING_ENV_QDRANT: {
    ko: "서비스 설정 문제로 데이터를 처리할 수 없습니다. 관리자에게 문의해 주세요.",
    en: "Your data couldn't be processed because of a service setup issue. Please contact support.",
    ja: "サービス設定の問題により、データを処理できませんでした。サポートへお問い合わせください。",
    de: "Ihre Daten konnten wegen eines Service-Einrichtungsproblems nicht verarbeitet werden. Bitte wenden Sie sich an den Support.",
    fr: "Vos donnees n'ont pas pu etre traitees en raison d'un probleme de configuration du service. Veuillez contacter le support.",
    it: "Non e stato possibile elaborare i tuoi dati a causa di un problema di configurazione del servizio. Contatta il supporto.",
    zh: "因服務設定問題，無法處理你的資料。請聯絡支援團隊。",
    es: "No se pudieron procesar tus datos por un problema de configuracion del servicio. Ponte en contacto con soporte."
  },
  WORKER_ERR_JOB_TIMEOUT: {
    ko: "데이터를 준비하는 데 시간이 너무 오래 걸려 작업이 중단되었습니다. 파일 크기나 행 수를 줄인 뒤 다시 시도해 주세요.",
    en: "Preparing your data took too long, so the process was stopped. Try again with a smaller file or fewer rows.",
    ja: "データの準備に時間がかかりすぎたため、処理が停止されました。ファイルサイズや行数を減らして再試行してください。",
    de: "Die Vorbereitung Ihrer Daten hat zu lange gedauert, daher wurde der Vorgang beendet. Versuchen Sie es mit einer kleineren Datei oder weniger Zeilen erneut.",
    fr: "La preparation de vos donnees a pris trop de temps et le traitement a ete arrete. Reessayez avec un fichier plus petit ou moins de lignes.",
    it: "La preparazione dei tuoi dati ha richiesto troppo tempo, quindi il processo e stato interrotto. Riprova con un file piu piccolo o con meno righe.",
    zh: "準備資料所需時間過長，因此系統已停止處理。請縮小檔案或減少資料列後再試。",
    es: "La preparacion de tus datos tardo demasiado, por lo que el proceso se detuvo. Intentalo con un archivo mas pequeno o con menos filas."
  },
  WORKER_ERR_JOB_SIGNAL: {
    ko: "데이터 준비가 중간에 중단되었습니다. 잠시 후 다시 시도해 주세요.",
    en: "Preparing your data was interrupted. Please try again later.",
    ja: "データの準備が途中で中断されました。しばらくしてから再試行してください。",
    de: "Die Vorbereitung Ihrer Daten wurde unterbrochen. Bitte versuchen Sie es spaeter erneut.",
    fr: "La preparation de vos donnees a ete interrompue. Veuillez reessayer plus tard.",
    it: "La preparazione dei tuoi dati e stata interrotta. Riprova piu tardi.",
    zh: "準備資料的過程已中斷，請稍後再試。",
    es: "La preparacion de tus datos se interrumpio. Intentalo de nuevo mas tarde."
  },
  WORKER_ERR_DATASET_REQUIRED: {
    ko: "데이터셋 정보를 확인할 수 없습니다. 다시 시도해 주세요.",
    en: "We couldn't identify the data set. Please try again.",
    ja: "データセット情報を確認できませんでした。もう一度お試しください。",
    de: "Der Datensatz konnte nicht erkannt werden. Bitte versuchen Sie es erneut.",
    fr: "Impossible d'identifier le jeu de donnees. Veuillez reessayer.",
    it: "Non e stato possibile identificare il set di dati. Riprova.",
    zh: "無法識別資料集，請再試一次。",
    es: "No pudimos identificar el conjunto de datos. Intentalo de nuevo."
  },
  WORKER_ERR_FIRESTORE: {
    ko: "처리 상태를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    en: "We couldn't save the processing status. Please try again shortly.",
    ja: "処理状況を保存できませんでした。しばらくしてから再試行してください。",
    de: "Der Verarbeitungsstatus konnte nicht gespeichert werden. Bitte versuchen Sie es in Kurze erneut.",
    fr: "Nous n'avons pas pu enregistrer l'etat du traitement. Veuillez reessayer dans un instant.",
    it: "Non siamo riusciti a salvare lo stato dell'elaborazione. Riprova tra poco.",
    zh: "未能儲存處理狀態，請稍後再試。",
    es: "No pudimos guardar el estado del procesamiento. Intentalo de nuevo dentro de un momento."
  }
};

/**
 * @param {string} rawMessage
 * @returns {{ key: string, vars: Record<string, string> }}
 */
function classifyWorkerError(rawMessage) {
  const m = String(rawMessage || "");
  const lower = m.toLowerCase();

  const timeoutMin = m.match(/execution exceeded\s+(\d+)\s+minutes/i);
  if (timeoutMin) {
    return { key: "WORKER_ERR_JOB_TIMEOUT", vars: { minutes: timeoutMin[1] } };
  }

  const signalMatch = m.match(/\(signal:\s*([^)]+)\)/i);
  if (m.includes("Job terminated by Cloud Run") && signalMatch) {
    return {
      key: "WORKER_ERR_JOB_SIGNAL",
      vars: { signal: signalMatch[1].trim() }
    };
  }

  if (
    m.includes("TENANT environment variable is required") ||
    m === "TENANT is required"
  ) {
    return { key: "WORKER_ERR_MISSING_ENV_TENANT", vars: {} };
  }

  if (
    m.includes("GCS_PATH environment variable is required") ||
    m.includes("GCS_PATH is required")
  ) {
    return { key: "WORKER_ERR_MISSING_ENV_GCS", vars: {} };
  }

  if (m.includes("OPENAI_API_KEY is required")) {
    return { key: "WORKER_ERR_MISSING_ENV_OPENAI", vars: {} };
  }

  if (m.includes("QDRANT_URL is required")) {
    return { key: "WORKER_ERR_MISSING_ENV_QDRANT", vars: {} };
  }

  if (m.includes("DATASET is required")) {
    return { key: "WORKER_ERR_DATASET_REQUIRED", vars: {} };
  }

  if (m.startsWith("Invalid GCS_PATH:")) {
    return { key: "WORKER_ERR_GCS_INVALID_PATH", vars: {} };
  }

  if (
    m.includes("Failed to read JSONL from GCS") ||
    m.includes("Invalid canonical JSONL")
  ) {
    return { key: "WORKER_ERR_GCS_JSONL", vars: {} };
  }

  if (m.includes("No valid rows found")) {
    return { key: "WORKER_ERR_NO_VALID_ROWS", vars: {} };
  }

  if (m.includes("Vector size mismatch for collection")) {
    return { key: "WORKER_ERR_QDRANT_VECTOR_COLLECTION", vars: {} };
  }

  if (
    m.includes("missing sparse vector") ||
    (m.includes("missing sparse") && m.includes("bm25"))
  ) {
    return { key: "WORKER_ERR_QDRANT_SPARSE_MISSING", vars: {} };
  }

  if (
    m.includes("Vector size mismatch:") &&
    m.includes("VECTOR_SIZE")
  ) {
    return { key: "WORKER_ERR_EMBED_VECTOR_SIZE", vars: {} };
  }

  // embedInBatches / validation: provider and point stage dimension mismatch.
  if (m.includes("Invalid embedding vector dimension")) {
    return { key: "WORKER_ERR_EMBED_VECTOR_SIZE", vars: {} };
  }

  // embedInBatches: response count mismatch.
  if (m.includes("Embedding batch size mismatch")) {
    return { key: "WORKER_ERR_EMBEDDING_FAILED", vars: {} };
  }

  if (m === "embedding failed" || lower === "embedding failed") {
    return { key: "WORKER_ERR_EMBEDDING_FAILED", vars: {} };
  }

  if (
    m.includes("OpenAI embedding request timed out") ||
    lower.includes("embed_max_retries") ||
    (lower.includes("embedding") &&
      (lower.includes("401") ||
        lower.includes("403") ||
        lower.includes("429") ||
        lower.includes("rate limit") ||
        lower.includes("api key")))
  ) {
    return { key: "WORKER_ERR_EMBEDDING_SERVICE", vars: {} };
  }

  // Firestore paths for transactions, token accumulation, etc.
  if (
    lower.includes("firestore") ||
    lower.includes("deadline exceeded") ||
    lower.includes("failed-precondition")
  ) {
    return { key: "WORKER_ERR_FIRESTORE", vars: {} };
  }

  if (
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("network error")
  ) {
    return { key: "WORKER_ERR_QDRANT_UNREACHABLE", vars: {} };
  }

  const qdrantHttp = m.match(/Qdrant\s+\w+\s+\S+\s+failed:\s*(\d{3})\b/i);
  if (qdrantHttp) {
    return {
      key: "WORKER_ERR_QDRANT_HTTP",
      vars: { status: qdrantHttp[1] }
    };
  }

  if (lower.includes("qdrant") && lower.includes("failed")) {
    return { key: "WORKER_ERR_QDRANT_HTTP", vars: { status: "?" } };
  }

  return { key: "WORKER_ERR_GENERIC", vars: {} };
}

/**
 * Convert original (English) worker error messages into user-friendly phrases matching tenant locale.
 * @param {string} rawMessage
 * @param {string} [locale]
 * @returns {string}
 */
function getWorkerLocalizedDatasetError(rawMessage, locale) {
  const lang = normalizeWorkerLocale(locale);
  const { key, vars } = classifyWorkerError(rawMessage);
  const bundle = MESSAGES[key] || MESSAGES.WORKER_ERR_GENERIC;
  const template = bundle[lang] || bundle.en;
  return applyTemplate(template, vars);
}

module.exports = {
  normalizeWorkerLocale,
  getWorkerLocalizedDatasetError
};
