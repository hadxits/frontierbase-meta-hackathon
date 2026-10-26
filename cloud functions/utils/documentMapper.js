/**
 * Firestore document를 객체로 가져옵니다.
 * 해당 매퍼를 통해 가져온 객체는 Firestore의 모든 필드를 값으로 가지며,
 * docId라는 document의 식별자를 갖습니다.
 * @param doc
 * @returns {*&{docId}}
 */
const docMapper = (doc) => {
  return {
    docId: doc.id,
    ...doc.data(),
  };
};

module.exports = docMapper;