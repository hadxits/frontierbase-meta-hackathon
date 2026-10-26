const { randomInt } = require('node:crypto');

/**
 * 무작위의 문자열을 생성합니다.
 * @param {number} len 문자열 길이
 * @param {string[]} _chars 문자 (기본값: 대소문자 알파벳과 숫자)
 * @returns 문자열 길이
 */
module.exports = (len, _chars) => {
    let str = '';
    let chars = (_chars ?? 'qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM0123456789').split('');

    for (let i = 0; i < len; i++) {
        str += chars[randomInt(0, chars.length)];
    }

    return str;
}