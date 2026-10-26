/**
 * template 문자열의 #{key}를 data의 key에 해당하는 값으로 바인딩합니다.
 *
 * 다음과 같은 경우에는 예외를 터뜨립니다.
 * 1. template에 data.key에 해당하는 값이 없는 경우
 * 2. data의 key를 모두 바인딩한 이후에 template에 #{key}가 남아있는 경우
 *
 * @param template #{key}를 포함해야 합니다.
 * @param data template에 바인딩할 데이터입니다. key-value 객체입니다.
 */
const renderTemplate = (template, data) => {
  let isObject = typeof template === 'object';

  if (isObject) {
    template = JSON.stringify(template);
  }

  // 0. 만약 data의 문자열 필드에 "가 있으면, \\"로 치환
  replaceQuotes(data);

  // 1. 모든 키가 데이터 객체에 있는지 확인
  checkKeysExist(template, data);

  // 2. 템플릿에서 키를 치환
  const replaced = replaceKeys(template, data);

  // 3. 만약 template이 object라면, object로 변환 후 반환
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