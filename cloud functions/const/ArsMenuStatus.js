/**
 * tenants/{tid}/ars_menus/{datasetId}.status
 * Mirrors dataset-style lifecycle (process / fail / ready-ish draft / published).
 */
const ARS_MENU_STATUS = Object.freeze({
  NONE: "none",
  PROCESSING: "processing",
  DRAFT: "draft",
  PUBLISHED: "published",
  FAILED: "failed",
  STALE: "stale",
  /** @deprecated use PROCESSING — kept for reading old docs */
  MAPPING: "mapping"
});

/** Stable non-localized bucket when depth label is missing / overflow merge. UI i18n this key. */
const ARS_OTHER_LABEL_KEY = "__ars_other__";

function isArsProcessingStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === ARS_MENU_STATUS.PROCESSING || s === ARS_MENU_STATUS.MAPPING;
}

function isArsOtherLabel(label) {
  return String(label || "").trim() === ARS_OTHER_LABEL_KEY;
}

module.exports = {
  ARS_MENU_STATUS,
  ARS_OTHER_LABEL_KEY,
  isArsProcessingStatus,
  isArsOtherLabel
};
