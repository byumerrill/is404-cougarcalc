const { createHash, randomBytes } = require('node:crypto');

const HISTORY_COOKIE_NAME = 'cougarcalc_history';
const HISTORY_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const MAX_COOKIE_HEADER_LENGTH = 4096;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function readHistoryCookieSecure(env = process.env) {
  const value = env.HISTORY_COOKIE_SECURE;
  if (typeof value === 'undefined') {
    return false;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error('HISTORY_COOKIE_SECURE must be either true or false.');
}

function generateHistoryToken(randomSource = randomBytes) {
  return randomSource(TOKEN_BYTES).toString('base64url');
}

function findHistoryToken(cookieHeader) {
  if (
    typeof cookieHeader !== 'string' ||
    cookieHeader.length === 0 ||
    cookieHeader.length > MAX_COOKIE_HEADER_LENGTH
  ) {
    return null;
  }

  const matchingValues = [];
  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const name = segment.slice(0, separator).trim();
    if (name === HISTORY_COOKIE_NAME) {
      matchingValues.push(segment.slice(separator + 1).trim());
    }
  }

  if (matchingValues.length !== 1 || !TOKEN_PATTERN.test(matchingValues[0])) {
    return null;
  }

  return matchingValues[0];
}

function hashHistoryToken(token) {
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error('Cannot hash an invalid browser history token.');
  }

  return createHash('sha256').update(token, 'ascii').digest('hex');
}

function serializeHistoryCookie(token, { secure = false } = {}) {
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error('Cannot serialize an invalid browser history token.');
  }

  const attributes = [
    `${HISTORY_COOKIE_NAME}=${token}`,
    `Max-Age=${HISTORY_COOKIE_MAX_AGE_SECONDS}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];

  if (secure) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

function createHistoryIdentity(
  cookieHeader,
  { secure = false, generateToken = generateHistoryToken } = {}
) {
  let token = findHistoryToken(cookieHeader);
  let setCookieHeader;

  if (!token) {
    token = generateToken();
    if (!TOKEN_PATTERN.test(token)) {
      throw new Error('The browser history token generator returned an invalid token.');
    }
    setCookieHeader = serializeHistoryCookie(token, { secure });
  }

  return {
    tokenHash: hashHistoryToken(token),
    setCookieHeader
  };
}

module.exports = {
  HISTORY_COOKIE_MAX_AGE_SECONDS,
  HISTORY_COOKIE_NAME,
  MAX_COOKIE_HEADER_LENGTH,
  TOKEN_BYTES,
  TOKEN_PATTERN,
  createHistoryIdentity,
  findHistoryToken,
  generateHistoryToken,
  hashHistoryToken,
  readHistoryCookieSecure,
  serializeHistoryCookie
};
