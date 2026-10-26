/**
 * ============================================================================
 * logRequest.js - 요청 로깅 유틸리티
 * ============================================================================
 *
 * HTTP 요청 정보를 로깅합니다.
 * tenant_id가 있으면 포함하여 로깅합니다.
 * ============================================================================
 */

const { logger } = require('firebase-functions/v2');
const requestIp = require('request-ip');
const { logWarn } = require('@/utils/logger');

/**
 * 요청 정보 로깅
 *
 * @param {Object} req - Express 요청 객체
 * @param {string} [req.body.tenant_id] - 테넌트 ID (선택)
 */
const logRequest = (req) => {
  const tenantId = req.body?.tenant_id || req.query?.tenant_id || null;
  const requestInfo = `Request Info\n` +
      `IP: ${requestIp.getClientIp(req)}\n` +
      `Method: ${req.method}\n` +
      `URL: ${req.originalUrl}\n` +
      `Headers: ${JSON.stringify(req.headers)}\n` +
      `Body: ${JSON.stringify(req.body)}\n`;

  // tenant_id가 없으면 "empty" 사용
  logWarn(requestInfo, {
    tenant_id: tenantId || "empty",
    function_name: "logRequest",
    extra: {
      ip: requestIp.getClientIp(req),
      method: req.method,
      url: req.originalUrl
    }
  });
};

module.exports = logRequest;