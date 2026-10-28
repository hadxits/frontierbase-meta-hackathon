/**
 * ============================================================================
 * logRequest.js - Request logging utility.
 * ============================================================================
 *
 * Logs HTTP request information.
 * Includes tenant_id in logs if present.
 * ============================================================================
 */

const { logger } = require('firebase-functions/v2');
const requestIp = require('request-ip');
const { logWarn } = require('@/utils/logger');

/**
 * Logs request information.
 *
 * @param {Object} req - Express request object.
 * @param {string} [req.body.tenant_id] - Tenant ID (optional).
 */
const logRequest = (req) => {
  const tenantId = req.body?.tenant_id || req.query?.tenant_id || null;
  const requestInfo = `Request Info\n` +
      `IP: ${requestIp.getClientIp(req)}\n` +
      `Method: ${req.method}\n` +
      `URL: ${req.originalUrl}\n` +
      `Headers: ${JSON.stringify(req.headers)}\n` +
      `Body: ${JSON.stringify(req.body)}\n`;

  // Use "empty" if tenant_id is missing.
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