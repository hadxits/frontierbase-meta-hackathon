const groupBy = (array, key) => {
  return Object.entries(
    array.reduce((result, currentValue) => {
      // Split array by group key.
      (result[currentValue[key]] = result[currentValue[key]] || []).push(
        currentValue
      );
      return result;
    }, {})
  );
};

module.exports = groupBy;