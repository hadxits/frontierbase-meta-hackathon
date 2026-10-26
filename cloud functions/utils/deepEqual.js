/**
 * 두 객체가 같은지 비교하는 함수
 * @param {Object} obj1 - 비교할 첫 번째 객체
 * @param {Object} obj2 - 비교할 두 번째 객체
 * @returns {boolean} 두 객체가 같으면 true, 다르면 false
 */
const deepEqual = (obj1, obj2) => {
  // 객체의 참조가 같으면 true
  if (obj1 === obj2) {
    return true;
  }

  // 둘 중 하나가 null이거나 객체가 아니면 false
  if (
    obj1 == null ||
    obj2 == null ||
    typeof obj1 !== 'object' ||
    typeof obj2 !== 'object'
  ) {
    return false;
  }

  // 키 목록을 얻음
  let keys1 = Object.keys(obj1);
  let keys2 = Object.keys(obj2);

  // 키 개수가 다르면 false
  if (keys1.length !== keys2.length) {
    return false;
  }

  // 키와 값 비교
  for (let key of keys1) {
    if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
      return false;
    }
  }

  return true;
};

module.exports = deepEqual;