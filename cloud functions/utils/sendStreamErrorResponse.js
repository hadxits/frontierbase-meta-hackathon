const ApiError = require("@/errors/apiError");
const ErrorCode = require("@/const/ErrorCode");

function buildErrorResponse(error) {
  if (error instanceof ApiError) {
    if (error.returnToUser) {
      const body = {
        status: "error",
        errorCode: error.errorCode,
        message: error.message
      };
      if (error.data != null) {
        body.details = error.data;
      }
      return {
        statusCode: error.httpStatusCode,
        body
      };
    }

    return {
      statusCode: error.httpStatusCode,
      body: {
        status: "error",
        errorCode: "INVALID_REQUEST",
        message: "Invalid request."
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      status: "error",
      errorCode: ErrorCode.INTERNAL_SERVER_ERROR,
      message: "Request failed. Please try again later or contact support."
    }
  };
}

function sendStreamErrorResponse(response, error) {
  if (!response) {
    return { sent: false, mode: "missing_response" };
  }

  const { statusCode, body } = buildErrorResponse(error);

  try {
    if (!response.headersSent) {
      response.status(statusCode).send(body);
      return { sent: true, mode: "http" };
    }

    if (response.writableEnded || response.destroyed || !response.writable) {
      return { sent: false, mode: "unwritable" };
    }

    const ssePayload = {
      errorCode: body.errorCode,
      message: body.message
    };
    if (body.details != null) {
      ssePayload.details = body.details;
    }

    response.write("event: error\n");
    response.write(`data: ${JSON.stringify(ssePayload)}\n\n`);
    if (!response.writableEnded) {
      response.end();
    }
    return { sent: true, mode: "sse" };
  } catch (sendError) {
    return {
      sent: false,
      mode: response.headersSent ? "sse" : "http",
      error: sendError
    };
  }
}

module.exports = {
  sendStreamErrorResponse
};