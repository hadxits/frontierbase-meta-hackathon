/**
 * Binds #{key} in the template string to the corresponding value in data's key.
 *
 * Throws an exception in the following cases.
 * 1. When the template lacks a value for data.key
 * 2. When #{key} remains in the template after binding all keys from data
 *
 * @param template Must include #{key}
 * @param data Data to bind to the template; a key-value object.
 */
const renderTemplate = (template, data) => {
  let isObject = typeof template === 'object';

  if (isObject) {
    template = JSON.stringify(template);
  }

  // 0. If a string field in data contains ", replace it with \"
  replaceQuotes(data);

  // 1. Verify all keys exist in the data object
  checkKeysExist(template, data);

  // 2. Replace keys in the template
  const replaced = replaceKeys(template, data);

  // 3. If template is an object, convert and return as an object
  if (isObject) {
    return JSON.parse(replaced);
  } else {
    return replaced;
  }
};

const replaceQuotes = (data) => {
  Object.keys(data).forEach((key) => {
    if (typeof data[key] === 'string') {
      data[key] = data[key].replace(/"/g, '\\"');
    }
  });
};

const checkKeysExist = (template, data) => {
  const regex = /#{(.*?)}/g;
  let match;
  while ((match = regex.exec(template)) !== null) {
    const key = match[1];
    if (!data.hasOwnProperty(key)) {
      throw new Error(`Missing key '${key}' in data.`);
    }
  }
};

const replaceKeys = (template, data) => {
  return template.replace(/#{(.*?)}/g, (_, key) => {
    if (data.hasOwnProperty(key)) {
      return data[key];
    }
    throw new Error(`Key '${key}' not found in data.`);
  });
};

module.exports = renderTemplate;