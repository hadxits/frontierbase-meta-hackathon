// This file contains the ApiError class which is used to throw custom errors in the API.
const LogSeverity = require('@/LogSeverity');

/**
 * Class representing errors that occur during API requests.
 * Contains additional information beyond the original error.
 *
 * @param {string} errorCode Error code
 * @param {string} message Error message
 * @param {number} httpStatusCode HTTP status code, the response uses this code.
 * @param {Object} data Additional data
 * @param {boolean} returnToUser Whether to return the error to the user (default: false)
 * @param {LogSeverity} severity Severity level of the error
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