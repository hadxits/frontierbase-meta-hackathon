/**
 * billing window 계산 유틸리티
 * startDay 기준으로 windowStartAt과 windowEndAt을 계산
 */

/**
 * 현재 월에서 startDay에 해당하는 날짜를 찾거나, 없으면 이전 가능한 날짜로 조정
 * @param {Date} now - 현재 시간
 * @param {number} startDay - 원하는 일자 (1-31)
 * @returns {Date} - 조정된 날짜
 */
function adjustDayInMonth(now, startDay) {
  const year = now.getFullYear();
  const month = now.getMonth();

  // 해당 월의 마지막 날짜 확인
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  // startDay가 해당 월에 존재하는지 확인
  let targetDay = startDay;
  if (startDay > lastDayOfMonth) {
    // startDay가 해당 월에 없으면 마지막 날짜로 조정
    targetDay = lastDayOfMonth;
  }

  return new Date(year, month, targetDay);
}

/**
 * billing window 계산
 * @param {Date} now - 현재 시간
 * @param {number} startDay - 빌링 시작일 (1-31)
 * @param {Date|null} existingWindowStartAt - 기존 windowStartAt (시,분,초 유지용)
 * @returns {{windowStartAt: Date, windowEndAt: Date}} - 계산된 window
 */
function calculateBillingWindow(now, startDay, existingWindowStartAt = null) {
  // 현재 월의 startDay 날짜 계산 (없으면 조정)
  const currentMonthStart = adjustDayInMonth(now, startDay);

  // windowStartAt: 현재 월의 startDay
  let windowStartAt = new Date(currentMonthStart);

  // 기존 windowStartAt이 있으면 시,분,초 유지 (Date 객체로 전달됨)
  if (existingWindowStartAt) {
    const existingDate = existingWindowStartAt instanceof Date
      ? existingWindowStartAt
      : new Date(existingWindowStartAt);
    windowStartAt.setHours(existingDate.getHours());
    windowStartAt.setMinutes(existingDate.getMinutes());
    windowStartAt.setSeconds(existingDate.getSeconds());
    windowStartAt.setMilliseconds(existingDate.getMilliseconds());
  } else {
    // 기존 값이 없으면 00:00:00으로 설정
    windowStartAt.setHours(0, 0, 0, 0);
  }

  // windowEndAt: 다음 달의 startDay (없으면 조정)
  const nextMonth = new Date(currentMonthStart);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStart = adjustDayInMonth(nextMonth, startDay);

  let windowEndAt = new Date(nextMonthStart);
  // windowEndAt의 시,분,초는 windowStartAt과 동일하게 설정
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
 * billing window가 만료되었는지 확인
 * @param {number|Date} windowEndAt - window 종료 시간 (timestamp 또는 Date)
 * @param {Date} now - 현재 시간
 * @returns {boolean} - 만료 여부
 */
function isBillingWindowExpired(windowEndAt, now) {
  const endTime = windowEndAt instanceof Date
    ? windowEndAt.getTime()
    : (typeof windowEndAt === 'number' ? windowEndAt : new Date(windowEndAt).getTime());
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return nowTime >= endTime;
}

/**
 * billingKey 생성
 * @param {number|Date} windowStartAt - window 시작 시간
 * @param {number|Date} windowEndAt - window 종료 시간
 * @returns {string} - billingKey (예: "1767686567271_1767686567272")
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
 * 날짜를 YYYY-MM-DD 형식으로 변환
 * @param {Date} date - 날짜
 * @returns {string} - YYYY-MM-DD 형식 문자열
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