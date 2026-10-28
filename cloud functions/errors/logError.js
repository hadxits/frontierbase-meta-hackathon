const { logger } = require('firebase-functions/v2');
const {
  formatTraceLogMessage,
  getRequestTraceId
} = require("@/utils/requestTrace");

const createErrorSummary = (errorInfo) => {
  return `
    Error occurs.
    
    * id: ${errorInfo.id}
    * severity: ${errorInfo.severity.label}
    * errorCode: ${errorInfo.errorCode}
    * message: ${errorInfo.message}
    * data: ${JSON.stringify(errorInfo.data)}
    * fileName: ${errorInfo.fileName}
    * functionName: ${errorInfo.functionName}
    * lineNumber: ${errorInfo.lineNumber}
    * createdAt: ${new Date(errorInfo.timeStamp)}
    * stack: ${errorInfo.error.stack}
    `;
};

/**
 * Refines and outputs the error.
 */
const logError = (errorInfo) => {
  const errorSummary = createErrorSummary(errorInfo);
  const traceId = getRequestTraceId();
  logger.error(formatTraceLogMessage(errorSummary, traceId), {
    ...(traceId ? { request_trace_id: traceId } : {})
  });
};

module.exports = logError;