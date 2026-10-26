const crypto = require("crypto");

/**
 * 지원 티켓 번호 생성 (예: FB-20260511-A1B2C3)
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
 * Issue Track 이슈 번호 생성 (예: ISS-20260511-A1B2C3)
 * 제품 지원 FB-* 와 분리
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