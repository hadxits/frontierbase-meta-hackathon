/**
 * HTTP 핸들러 시작 시각부터 현재까지 경과 시간(초)를 소수 1자리로 반올림.
 * 메시지 서브컬렉션 저장 시 응답 지연 기록용.
 *
 * @param {number} requestStartedAtMs - Date.now() 기준 요청 시작 시각
 * @returns {number} 예: 1.523 → 1.5
 */
function elapsedResponseSeconds(requestStartedAtMs) {
  const t0 = Number(requestStartedAtMs);
  const base = Number.isFinite(t0) ? t0 : Date.now();
  const sec = (Date.now() - base) / 1000;
  return Math.round(sec * 10) / 10;
}

module.exports = { elapsedResponseSeconds };