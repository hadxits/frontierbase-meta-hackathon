const CryptoJS = require('crypto-js');
const environment = require('@/env');

/**
 * Encrypt the given data and return it.
 * @param data Data to encrypt.
 * @param key Encryption key, defaults to ENCRYPTION_KEY environment variable.
 * @returns Encrypted string.
 */
const encrypt = (data, key) => {
  const encryptionKey = key || environment.ENCRYPTION_KEY;
  if (typeof data === 'object') {
    // Handle circular references: safely serialize objects with circular references.
    try {
      data = JSON.stringify(data);
    } catch (error) {
      // Use safe fallback if circular references or serialization errors occur.
      if (error.message && error.message.includes('circular')) {
        // Recursive function to remove circular references.
        const seen = new WeakSet();
        const safeStringify = (obj) => {
          if (obj === null || typeof obj !== 'object') {
            return obj;
          }
          if (seen.has(obj)) {
            return '[Circular]';
          }
          seen.add(obj);
          if (obj instanceof Error) {
            return {
              name: obj.name,
              message: obj.message,
              stack: obj.stack
            };
          }
          if (typeof obj.toJSON === 'function') {
            return obj.toJSON();
          }
          if (Array.isArray(obj)) {
            return obj.map(safeStringify);
          }
          const result = {};
          for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
              try {
                result[key] = safeStringify(obj[key]);
              } catch (e) {
                result[key] = '[Unable to serialize]';
              }
            }
          }
          return result;
        };
        data = JSON.stringify(safeStringify(data));
      } else {
        // Rethrow original error for other serialization errors.
        throw error;
      }
    }
  }
  return CryptoJS.AES.encrypt(String(data), encryptionKey).toString();
};

/**
 * Return decrypted result as a string.
 * @param text String to decrypt.
 * @param key Encryption key, defaults to ENCRYPTION_KEY environment variable.
 * @returns {any} The decrypted object
 */
const decryptAsString = (text, key) => {
  const encryptionKey = key || environment.ENCRYPTION_KEY;
  const bytes = CryptoJS.AES.decrypt(text, encryptionKey);
  return bytes.toString(CryptoJS.enc.Utf8);
};

/**
 * Returns the result of decryption as an object.
 * @param text String to decrypt.
 * @param key Encryption key, defaults to ENCRYPTION_KEY environment variable.
 * @returns {any} The decrypted object
 */
const decrypt = (text, key) => {
  return JSON.parse(decryptAsString(text, key));
};


module.exports = { encrypt, decrypt, decryptAsString };