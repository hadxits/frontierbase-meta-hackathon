/**
 * Convert a phone number to local format
 */
const toLocalPhoneNumber = (phone) => {
  if (phone.startsWith('+82')) {
    return phone.replace('+82', '0');
  }

  return phone;
};

module.exports = toLocalPhoneNumber;