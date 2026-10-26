const _onRequest = require('@/_onRequest');
const PropertyType = require('@/const/ajv/PropertyType');
const { auth } = require('@/firebase');

const createToken = _onRequest({
  opts: {
    memory: '256MiB',
  },
  params: {
    type: PropertyType.OBJECT,
    properties: {
      id: { type: PropertyType.STRING },
    },
    required: ['id'],
    additionalProperties: false,
  },
  handler: async (request) => {
    const customToken = await auth.createCustomToken(request.body.id);
    return { customToken };
  },
});

module.exports = createToken;