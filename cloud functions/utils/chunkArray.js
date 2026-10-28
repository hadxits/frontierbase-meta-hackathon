/**
 * Utility function to split an array into chunks of given size.
 * @param {Array} array - Original array.
 * @param {number} size - Size of each sub-array.
 * @returns {Array} - Two-dimensional array.
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