const HttpMethod = require('@/const/HttpMethod');
const ApiError = require('@/errors/apiError');
const LogSeverity = require('@/LogSeverity');

/**
 * Only POST method is allowed.
 * Exception: health checks do not reach this filter
 * - With x-health-check header, _onRequest immediately returns 200, skipping this filter
 * - cloudRunHealthCheck: enableSecurityFilter=false disables this filter
 */
const httpMethodFilter = (req) => {
  if (req.method !== HttpMethod.POST) {
    throw new ApiError({
      errorCode: 'INVALID_HTTP_METHOD',
      message: 'Invalid HTTP Method: POST method is required.',
      severity: LogSeverity.ERROR
    });
  }
};

module.exports = httpMethodFilter;