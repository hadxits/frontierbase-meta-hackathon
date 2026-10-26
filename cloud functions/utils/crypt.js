const CryptoJS = require('crypto-js');
const environment = require('@/env');

/**
 * 주어진 data를 암호화하여 반환합니다.
 * @param data 암호화 할 데이터
 * @param key 암호화 키, 기본값은 환경변수의 ENCRYPTION_KEY
 * @returns  암호화된 문자열
 */
const encrypt = (data, key) => {
  const encryptionKey = key || environment.ENCRYPTION_KEY;
  if (typeof data === 'object') {
    // 순환 참조 처리: 순환 참조가 있는 객체는 안전하게 직렬화
    try {
      data = JSON.stringify(data);
    } catch (error) {
      // 순환 참조가 있거나 직렬화할 수 없는 경우, 안전한 대체 방법 사용
      if (error.message && error.message.includes('circular')) {
        // 순환 참조 제거를 위한 재귀 함수
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
        // 다른 직렬화 오류인 경우 원본 에러를 다시 throw
        throw error;
      }
    }
  }
  return CryptoJS.AES.encrypt(String(data), encryptionKey).toString();
};

/**
 * 복호화를 수행한 결과를 string으로 반환합니다.
 * @param text 복호화할 문자열
 * @param key 암호화 키, 기본값은 환경변수의 ENCRYPTION_KEY
 * @returns {any} 복호화된 객체
 */
const decryptAsString = (text, key) => {
  const encryptionKey = key || environment.ENCRYPTION_KEY;
  const bytes = CryptoJS.AES.decrypt(text, encryptionKey);
  return bytes.toString(CryptoJS.enc.Utf8);
};

/**
 * 복호화를 수행한 결과를 object으로 반환합니다.
 * @param text 복호화할 문자열
 * @param key 암호화 키, 기본값은 환경변수의 ENCRYPTION_KEY
 * @returns {any} 복호화된 객체
 */
const decrypt = (text, key) => {
  return JSON.parse(decryptAsString(text, key));
};


module.exports = { encrypt, decrypt, decryptAsString };