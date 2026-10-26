const isEmpty = (value) => {
  return (
    value === '' ||
    value === undefined ||
    value === null ||
    (typeof value === 'object' && Object.keys(value).length === 0)
  );
};

module.exports = isEmpty;