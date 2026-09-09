const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../browser-identity');

const VALID_TOKEN = 'A'.repeat(43);
const REPLACEMENT_TOKEN = 'B'.repeat(43);

test('history tokens use 32 cryptographically random bytes encoded as base64url', () => {
  let requestedBytes;
  const token = generateHistoryToken((byteCount) => {
    requestedBytes = byteCount;
    return Buffer.alloc(byteCount, 7);
  });

  assert.equal(requestedBytes, TOKEN_BYTES);
  assert.equal(TOKEN_BYTES, 32);
  assert.match(token, TOKEN_PATTERN);
});

test('history token hashing is deterministic SHA-256 without exposing the token', () => {
  const hash = hashHistoryToken(VALID_TOKEN);

  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, hashHistoryToken(VALID_TOKEN));
  assert.equal(hash.includes(VALID_TOKEN), false);
});

test('a new HTTP browser receives the required persistent cookie attributes', () => {
  const identity = createHistoryIdentity(undefined, {
    generateToken: () => VALID_TOKEN
  });

  assert.equal(identity.tokenHash, hashHistoryToken(VALID_TOKEN));
  assert.equal(
    identity.setCookieHeader,
    `${HISTORY_COOKIE_NAME}=${VALID_TOKEN}; ` +
      `Max-Age=${HISTORY_COOKIE_MAX_AGE_SECONDS}; ` +
      'Path=/; HttpOnly; SameSite=Lax'
  );
  assert.equal(identity.setCookieHeader.includes('Secure'), false);
});

test('HTTPS cookie configuration adds Secure', () => {
  const cookie = serializeHistoryCookie(VALID_TOKEN, { secure: true });

  assert.match(cookie, /; Secure$/);
});

test('a valid existing cookie is reused without another Set-Cookie header', () => {
  const identity = createHistoryIdentity(
    `theme=blue; ${HISTORY_COOKIE_NAME}=${VALID_TOKEN}; another=value`,
    { generateToken: () => REPLACEMENT_TOKEN }
  );

  assert.equal(identity.tokenHash, hashHistoryToken(VALID_TOKEN));
  assert.equal(identity.setCookieHeader, undefined);
});

test('missing, malformed, duplicate, and oversized cookies get a new identity', () => {
  const invalidHeaders = [
    undefined,
    `${HISTORY_COOKIE_NAME}=not-valid`,
    `${HISTORY_COOKIE_NAME}=${VALID_TOKEN}; ${HISTORY_COOKIE_NAME}=${VALID_TOKEN}`,
    `unrelated=${'x'.repeat(MAX_COOKIE_HEADER_LENGTH)}`
  ];

  for (const cookieHeader of invalidHeaders) {
    const identity = createHistoryIdentity(cookieHeader, {
      generateToken: () => REPLACEMENT_TOKEN
    });

    assert.equal(identity.tokenHash, hashHistoryToken(REPLACEMENT_TOKEN));
    assert.match(
      identity.setCookieHeader,
      new RegExp(`^${HISTORY_COOKIE_NAME}=${REPLACEMENT_TOKEN};`)
    );
  }
});

test('cookie extraction never accepts a body or URL value', () => {
  assert.equal(findHistoryToken(`${HISTORY_COOKIE_NAME}=${VALID_TOKEN}`), VALID_TOKEN);
  assert.equal(findHistoryToken(`other=${VALID_TOKEN}`), null);
});

test('HISTORY_COOKIE_SECURE defaults false and accepts only exact booleans', () => {
  assert.equal(readHistoryCookieSecure({}), false);
  assert.equal(readHistoryCookieSecure({ HISTORY_COOKIE_SECURE: 'false' }), false);
  assert.equal(readHistoryCookieSecure({ HISTORY_COOKIE_SECURE: 'true' }), true);

  for (const value of ['', 'TRUE', 'yes', '1']) {
    assert.throws(
      () => readHistoryCookieSecure({ HISTORY_COOKIE_SECURE: value }),
      /HISTORY_COOKIE_SECURE must be either true or false/
    );
  }
});

test('invalid tokens cannot be hashed or serialized', () => {
  assert.throws(() => hashHistoryToken('invalid'), /invalid browser history token/);
  assert.throws(
    () => serializeHistoryCookie('invalid'),
    /invalid browser history token/
  );
});
