/**
 * Fetches a Firestore document as an object.
 * The object fetched through this mapper contains all Firestore fields as values,
 * and includes a document identifier called docId.
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