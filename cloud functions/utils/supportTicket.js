const crypto = require("crypto");

/**
 * Generate support ticket number (e.g., FB-20260511-A1B2C3).
 * @returns {string}
 */
function generateSupportTicketNumber() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `FB-${y}${m}${day}-${suffix}`;
}

/**
 * Evidence uses a 10-minute signed URL during analysis → OpenAI input_file.file_url (contents from GCS as is).
 * Separate from product support FB-*.
 * @returns {string}
 */
function generateIssueTrackNumber() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `ISS-${y}${m}${day}-${suffix}`;
}

module.exports = {
  generateSupportTicketNumber,
  generateIssueTrackNumber,
};