const environment = require('@/env');
const isEmpty = require('@/utils/isEmpty');
const { decrypt } = require('@/utils/crypt');
const ApiError = require('@/errors/apiError');
const LogSeverity = require('@/LogSeverity');

/** Requests via gateway(api.frontierbase.io/chat): body is already plaintext, skip decryption */
const GATEWAY_SKIP_DECRYPT_HEADER = 'x-internal-gateway';

const bodyDecryptionFilter = (request) => {
  if (request.headers && request.headers[GATEWAY_SKIP_DECRYPT_HEADER] === '1') {
    return;
  }

  if (isEmpty(request.body)) {
    throw new ApiError({
      httpStatusCode: 400,
      errorCode: 'INVALID_REQUEST',
      message: 'Request body is empty.',
      severity: LogSeverity.WARNING
    });
  }

  try {
    request.body = environment.ENCRYPTION_ENABLED
      ? decrypt(request.body)
      : request.body;
  } catch (error) {
    // when decryption fails
    throw new ApiError({
      httpStatusCode: 500,
      errorCode: 'DECRYPTION_FAILED',
      message: 'Failed to decrypt request body.',
      severity: LogSeverity.WARNING
    });
  }
};

module.exports = bodyDecryptionFilter;