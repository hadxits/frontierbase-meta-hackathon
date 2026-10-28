/**
 * Utility function to remove duplicate elements from an array
 * @param {Array} array - Array to remove duplicates from
 * @returns {Array} New array with duplicates removed
 */
const removeDuplicatesInSimpleArray = (array) => {
  return [...new Set(array)];
};

module.exports = removeDuplicatesInSimpleArray;