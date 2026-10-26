const HttpMethod = require('@/const/HttpMethod');
const ApiError = require('@/errors/apiError');
const LogSeverity = require('@/LogSeverity');

/**
 * method는 POST만 허용합니다.
 * 예외: health 체크는 이 필터에 도달하지 않음
 * - x-health-check 헤더 시 _onRequest에서 즉시 200 반환하여 이 필터 미진입
 * - cloudRunHealthCheck: enableSecurityFilter=false 로 이 필터 미적용
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