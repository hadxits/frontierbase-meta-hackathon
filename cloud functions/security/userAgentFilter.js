const environment = require('@/env');
const allowedUserAgentPatterns = [
  /Mozilla\/5\.0.*Chrome\/[0-9.]+.*Safari\/[0-9.]+/, // Chrome
  /Mozilla\/5\.0.*Gecko\/[0-9.]+.*Firefox\/[0-9.]+/, // Firefox
  /Mozilla\/5\.0.*AppleWebKit\/[0-9.]+.*Safari\/[0-9.]+/, // Safari
  /Mozilla\/5\.0.*AppleWebKit\/[0-9.]+.*Edg\/[0-9.]+/, // Edge
  /Mozilla\/5\.0.*AppleWebKit\/[0-9.]+.*KAKAOTALK\/[0-9.]+/, // KakaoTalk WebView
];

const userAgentFilter = (req) => {
  if (environment.PROFILE === 'local') {
    return;
  }

  const userAgent = req.get('User-Agent');

  if (
    !userAgent ||
    !allowedUserAgentPatterns.some((pattern) => pattern.test(userAgent))
  ) {
    throw new Error();
  }
};

module.exports = userAgentFilter;