const { v4: uuid } = require('uuid');
const ApiError = require('./apiError');
const LogSeverity = require('@/LogSeverity');

/**
 * 에러의 정보를 담고 있는 정보 클래스입니다.
 * Custom 에러가 발생하든, 시스템 에러가 발생하든 이곳을 거친 이후 해당 객체를 통해 핸들링합니다.
 */
class ErrorInfo {
  constructor(error) {
    const { functionName, fileName, lineNumber } =
      this.#getErrorLocation(error);

    this.error = error;
    this.severity =
      error instanceof ApiError ? error.severity : LogSeverity.ERROR;
    this.id = uuid();
    this.errorCode = error.errorCode ?? 'INTERNAL_SERVER_ERROR';
    this.message = error.message;
    this.data = error.data ? error.data : ' - ';
    this.fileName = fileName;
    this.functionName = functionName;
    this.lineNumber = lineNumber;
    this.timeStamp = new Date().getTime();
  }

  /**
   * stack trace로부터 fileName, functionname, lineNumber 를 추출해냅니다.
   * @param error
   * @returns {{fileName: string, functionName: string, lineNumber: string}}
   */
  #getErrorLocation = (error) => {
    if ('stack' in error) {
      const stackLines = error.stack.split('\n');
      for (let i = 1; i < stackLines.length; i++) {
        const line = stackLines[i].trim();
        if (line) {
          const match = line.match(/at (\S+) \((.+):(\d+):(\d+)\)/);
          if (match) {
            return {
              functionName: match[1],
              fileName: match[2],
              lineNumber: match[3],
            };
          } else {
            const matchNoFunction = line.match(/at (.+):(\d+):(\d+)/);
            if (matchNoFunction) {
              return {
                functionName: 'unknown',
                fileName: matchNoFunction[1],
                lineNumber: matchNoFunction[2],
              };
            }
          }
        }
      }
    }

    return {
      functionName: 'unknown',
      fileName: 'unknown',
      lineNumber: 'unknown',
    };
  };
}

module.exports = ErrorInfo;