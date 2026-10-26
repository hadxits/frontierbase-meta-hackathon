/**
 * 서버 타임스탬프 반환 함수
 * ✅ 개선: Node.js 내장 Date 사용 (moment-timezone 대체)
 * 
 * 참고: Firestore는 UTC 타임스탬프를 사용하므로 Date.now()를 사용합니다.
 * 특정 시간대가 필요한 경우 클라이언트 측에서 변환하거나,
 * Firestore의 serverTimestamp()를 사용하는 것을 권장합니다.
 * 
 * @returns {number} UTC 타임스탬프 (밀리초)
 */
const getServerTimestamp = () => {
  return Date.now();
};

module.exports = getServerTimestamp;