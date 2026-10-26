// This file contains the ApiError class which is used to throw custom errors in the API.
const LogSeverity = require('@/LogSeverity');

/**
 * API 요청 중 발생한 에러를 나타내는 클래스입니다.
 * 기존 에러에 더해 부가적인 정보를 담습니다.
 *
 * @param {string} errorCode 에러 코드
 * @param {string} message 에러 메시지
 * @param {number} httpStatusCode HTTP 상태 코드, 이곳에 설정된 코드로 응답합니다.
 * @param {Object} data 추가 데이터
 * @param {boolean} returnToUser 사용자에게 에러를 반환할지 여부 (기본값: false)
 * @param {LogSeverity} severity 에러의 심각도
 */
class ApiError extends Error {
  constructor({
    errorCode = 'INVALID_REQUEST',
    message = 'Invalid request.',
    httpStatusCode = 400,
    data,
    returnToUser = false,
    severity = LogSeverity.ERROR,
  } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.errorCode = errorCode;
    this.message = message;
    this.httpStatusCode = httpStatusCode;
    this.data = data;
    this.returnToUser = returnToUser;
    this.severity = severity;
  }
}

module.exports = ApiError;