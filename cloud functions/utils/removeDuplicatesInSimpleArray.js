/**
 * 배열에서 중복된 요소를 제거하는 유틸리티 함수
 * @param {Array} array - 중복을 제거할 배열
 * @returns {Array} 중복이 제거된 새로운 배열
 */
const removeDuplicatesInSimpleArray = (array) => {
  return [...new Set(array)];
};

module.exports = removeDuplicatesInSimpleArray;