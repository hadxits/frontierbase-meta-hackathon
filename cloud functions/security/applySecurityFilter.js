const environment = require('@/env');
const ApiError = require('@/errors/apiError');
const LogSeverity = require('@/LogSeverity');
const logRequest = require('@/utils/logRequest');

/**
 * 필터 생성 이후 아래 목록에 추가해주세요.
 * 아래 정의된 순서대로 필터가 수행됩니다.
 */
const filters = [
  require('./httpMethodFilter'),
  require('./bodyDecryptionFilter')
];

/**
 * applySecurityFilter: HTTP 요청에 대해 보안 검증을 수행합니다.
 *
 * Todo: IP Whitelist, Blacklist 추가하기
 *
 * About SecurityFilter:
 * SecurityFilter layer는 HTTP 요청에 대한 보안 검증을 수행합니다.
 * filter 메서드는 request, response를 인자로 받아 검증을 수행합니다.
 * filter 메서드에서 발생한 예외는 로깅 후 재throw되며, _onRequest의 catch에서 HTTP 응답으로 반환됩니다.
 * filter 메서드를 만들 때에 유의하여 주세요.
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