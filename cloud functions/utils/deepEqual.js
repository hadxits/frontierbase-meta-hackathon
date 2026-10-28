/**
 * Function to compare if two objects are equal
 * @param {Object} obj1 - The first object to compare
 * @param {Object} obj2 - The second object to compare
 * @returns {boolean} True if the two objects are equal, false otherwise
 */
const deepEqual = (obj1, obj2) => {
  // Returns true if the object references are the same
  if (obj1 === obj2) {
    return true;
  }

  // Returns false if either is null or not an object
  if (
    obj1 == null ||
    obj2 == null ||
    typeof obj1 !== 'object' ||
    typeof obj2 !== 'object'
  ) {
    return false;
  }

  // Get the list of keys
  let keys1 = Object.keys(obj1);
  let keys2 = Object.keys(obj2);

  // Returns false if the number of keys is different
  if (keys1.length !== keys2.length) {
    return false;
  }

  // Compare keys and values
  for (let key of keys1) {
    if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
      return false;
    }
  }

  return true;
};

module.exports = deepEqual;