/**
 * Function to return server timestamp
 * ✅ Improvement: Use Node.js built-in Date (replace moment-timezone)
 * 
 * Note: Firestore uses UTC timestamps, so use Date.now().
 * If a specific timezone is needed, convert on client side,
 * or use Firestore's serverTimestamp() as recommended.
 * 
 * @returns {number} UTC timestamp (milliseconds)
 */
const getServerTimestamp = () => {
  return Date.now();
};

module.exports = getServerTimestamp;