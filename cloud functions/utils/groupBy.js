const groupBy = (array, key) => {
  return Object.entries(
    array.reduce((result, currentValue) => {
      // 그룹 키를 기준으로 배열을 나눕니다.
      (result[currentValue[key]] = result[currentValue[key]] || []).push(
        currentValue
      );
      return result;
    }, {})
  );
};

module.exports = groupBy;