/**
 * 배열을 주어진 크기 단위로 쪼개는 유틸 함수
 * @param {Array} array - 원본 배열
 * @param {number} size - 각 하위 배열의 크기
 * @returns {Array} - 2차원 배열
 */
const chunkArray = (array, size) => {
  if (size < 1) {
    throw new Error('Size must be greater than 0');
  }

  if (!Array.isArray(array)) {
    throw new Error('Input must be an array');
  }

  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

module.exports = chunkArray;