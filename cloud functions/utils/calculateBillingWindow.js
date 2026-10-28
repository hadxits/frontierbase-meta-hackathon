/**
 * Utility to calculate billing window
 * Calculate windowStartAt and windowEndAt based on startDay
 */

/**
 * Find date matching startDay in current month or adjust to nearest previous valid date
 * @param {Date} now - current time
 * @param {number} startDay - desired day (1-31)
 * @returns {Date} - adjusted date
 */
function adjustDayInMonth(now, startDay) {
  const year = now.getFullYear();
  const month = now.getMonth();

  // Check last date of the month
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  // Check if startDay exists in the month
  let targetDay = startDay;
  if (startDay > lastDayOfMonth) {
    // If startDay doesn't exist in the month, adjust to last date
    targetDay = lastDayOfMonth;
  }

  return new Date(year, month, targetDay);
}

/**
 * Calculate billing window
 * @param {Date} now - current time
 * @param {number} startDay - Billing start day (1-31)
 * @param {Date|null} existingWindowStartAt - Existing windowStartAt (to preserve hour, minute, second)
 * @returns {{windowStartAt: Date, windowEndAt: Date}} - Calculated window
 */
function calculateBillingWindow(now, startDay, existingWindowStartAt = null) {
  // Calculate the startDay date of the current month (adjust if missing)
  const currentMonthStart = adjustDayInMonth(now, startDay);

  // windowStartAt: startDay of the current month
  let windowStartAt = new Date(currentMonthStart);

  // If existing windowStartAt exists, preserve hour, minute, second (passed as Date object)
  if (existingWindowStartAt) {
    const existingDate = existingWindowStartAt instanceof Date
      ? existingWindowStartAt
      : new Date(existingWindowStartAt);
    windowStartAt.setHours(existingDate.getHours());
    windowStartAt.setMinutes(existingDate.getMinutes());
    windowStartAt.setSeconds(existingDate.getSeconds());
    windowStartAt.setMilliseconds(existingDate.getMilliseconds());
  } else {
    // If no existing value, set to 00:00:00
    windowStartAt.setHours(0, 0, 0, 0);
  }

  // windowEndAt: startDay of the next month (adjust if missing)
  const nextMonth = new Date(currentMonthStart);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStart = adjustDayInMonth(nextMonth, startDay);

  let windowEndAt = new Date(nextMonthStart);
  // Set windowEndAt's hour, minute, second to match windowStartAt
  windowEndAt.setHours(windowStartAt.getHours());
  windowEndAt.setMinutes(windowStartAt.getMinutes());
  windowEndAt.setSeconds(windowStartAt.getSeconds());
  windowEndAt.setMilliseconds(windowStartAt.getMilliseconds());

  return {
    windowStartAt,
    windowEndAt
  };
}

/**
 * Check if billing window has expired
 * @param {number|Date} windowEndAt - Window end time (timestamp or Date)
 * @param {Date} now - current time
 * @returns {boolean} - Whether expired
 */
function isBillingWindowExpired(windowEndAt, now) {
  const endTime = windowEndAt instanceof Date
    ? windowEndAt.getTime()
    : (typeof windowEndAt === 'number' ? windowEndAt : new Date(windowEndAt).getTime());
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return nowTime >= endTime;
}

/**
 * Generate billingKey
 * @param {number|Date} windowStartAt - Window start time
 * @param {number|Date} windowEndAt - Window end time
 * @returns {string} - billingKey (e.g., "1767686567271_1767686567272")
 */
function generateBillingKey(windowStartAt, windowEndAt) {
  const startTime = windowStartAt instanceof Date
    ? windowStartAt.getTime()
    : (typeof windowStartAt === 'number' ? windowStartAt : new Date(windowStartAt).getTime());
  const endTime = windowEndAt instanceof Date
    ? windowEndAt.getTime()
    : (typeof windowEndAt === 'number' ? windowEndAt : new Date(windowEndAt).getTime());
  return `${startTime}_${endTime}`;
}

/**
 * Convert date to YYYY-MM-DD format
 * @param {Date} date - Date
 * @returns {string} - String in YYYY-MM-DD format
 */
function formatDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

module.exports = {
  calculateBillingWindow,
  isBillingWindowExpired,
  generateBillingKey,
  formatDateString,
  adjustDayInMonth
};