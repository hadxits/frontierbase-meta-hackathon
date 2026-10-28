const { randomInt } = require('node:crypto');

/**
 * Generate a random string.
 * @param {number} len Length of the string.
 * @param {string[]} _chars Characters (default: uppercase and lowercase alphabets and numbers)
 * @returns Length of the string
 */
module.exports = (len, _chars) => {
    let str = '';
    let chars = (_chars ?? 'qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM0123456789').split('');

    for (let i = 0; i < len; i++) {
        str += chars[randomInt(0, chars.length)];
    }

    return str;
}