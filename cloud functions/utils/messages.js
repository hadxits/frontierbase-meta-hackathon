/**
 * ============================================================================
 * messages.js - Common utilities for multilingual messages
 * ============================================================================
 *
 * Provides common message logic including multilingual success messages.
 * ============================================================================
 */

const { detectLanguageFromLocale } = require("./localization");

/**
 * Extract language code from Locale
 * @param {string} locale - Locale string (e.g., "ko", "en", "ja", "de", "fr", "it", "zh", "es")
 * @returns {string} - Language code ("ko", "en", "ja", "de", "fr", "it", "zh", "es")
 */
function getLanguageFromLocale(locale) {
  return detectLanguageFromLocale(locale);
}

/**
 * Multilingual success messages related to Dataset
 * @param {string} locale - Locale string
 * @param {string} messageType - Message type ("upload" | "delete")
 * @returns {string} - Multilingual success message
 */
function getDatasetSuccessMessage(locale, messageType) {
  const lang = getLanguageFromLocale(locale);
  
  const messages = {
    upload: {
      ko: "데이터셋이 업로드되었습니다. 지금 사용할 수 있도록 준비 중입니다.",
      en: "Your data has been uploaded. We're preparing it for use now.",
      ja: "データセットをアップロードしました。ご利用いただけるよう準備しています。",
      de: "Ihre Daten wurden hochgeladen. Sie werden jetzt für die Nutzung vorbereitet.",
      fr: "Vos données ont bien été téléversées. Elles sont en cours de préparation.",
      it: "I tuoi dati sono stati caricati. Li stiamo preparando per l'uso.",
      zh: "資料集已成功上傳，現正建立索引。",
      es: "Tus datos se han cargado. Ahora los estamos preparando para su uso."
    },
    delete: {
      ko: "데이터셋이 삭제되었습니다.",
      en: "The data set has been deleted.",
      ja: "データセットを削除しました。",
      de: "Der Datensatz wurde gelöscht.",
      fr: "Le jeu de données a été supprimé.",
      it: "Il set di dati è stato eliminato.",
      zh: "資料集已成功刪除。",
      es: "El conjunto de datos ha sido eliminado."
    }
  };

  const typeMessages = messages[messageType] || messages.upload;
  return typeMessages[lang] || typeMessages.en;
}

module.exports = {
  getLanguageFromLocale,
  getDatasetSuccessMessage
};