const environment = require('@/env');
const ApiError = require('@/errors/apiError');
const LogSeverity = require('@/LogSeverity');
const logRequest = require('@/utils/logRequest');

/**
 * Add to the list below after creating filters.
 * Filters are applied in the order defined below.
 */
const filters = [
  require('./httpMethodFilter'),
  require('./bodyDecryptionFilter')
];

/**
 * applySecurityFilter: Performs security checks on HTTP requests.
 *
 * Todo: Add IP Whitelist and Blacklist
 *
 * About SecurityFilter:
 * SecurityFilter layer performs security validation on HTTP requests.
 * The filter method takes request and response as arguments and performs validation.
 * Exceptions in the filter method are logged and rethrown, then returned as HTTP responses in _onRequest's catch.
 * Be careful when creating the filter method.
 *
 * @param req HttpRequest
 * @param res HttpResponse
 */
const applySecurityFilter = async (req, res) => {
  if (environment.SECURITY_FILTER_ENABLED) {
    try {
      for (const filter of filters) {
        await filter(req, res);
      }
    } catch (error) {
      logRequest(req);
      throw error;
    }
  }
};

module.exports = applySecurityFilter;