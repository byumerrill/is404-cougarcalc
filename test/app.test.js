const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { app, getEnvironmentLabel } = require('../app');

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function postCalculation(body) {
  const response = await fetch(`${baseUrl}/calculate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const responseBody = await response.json();
  return { response, body: responseBody };
}

test('POST /calculate evaluates expressions using operator precedence', async () => {
  const { response, body } = await postCalculation({ expression: '2 + 3 * 4' });

  assert.equal(response.status, 200);
  assert.equal(body.result, 14);
});

test('POST /calculate evaluates parentheses and negative numbers', async () => {
  const { response, body } = await postCalculation({ expression: '(2 + 3) * -4' });

  assert.equal(response.status, 200);
  assert.equal(body.result, -20);
});

test('POST /calculate normalizes floating-point results', async () => {
  const { response, body } = await postCalculation({ expression: '0.1 + 0.2' });

  assert.equal(response.status, 200);
  assert.equal(body.result, 0.3);
});

test('POST /calculate supports each legacy arithmetic operation', async () => {
  const cases = [
    { operation: '+', expected: 10 },
    { operation: '-', expected: 4 },
    { operation: '*', expected: 21 },
    { operation: '/', expected: 7 / 3 }
  ];

  for (const { operation, expected } of cases) {
    const { response, body } = await postCalculation({ a: 7, b: 3, operation });
    assert.equal(response.status, 200);
    assert.equal(body.result, expected);
  }
});

test('POST /calculate rejects an empty expression', async () => {
  const { response, body } = await postCalculation({ expression: '   ' });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'Please enter a valid expression.');
});

test('POST /calculate rejects a malformed expression', async () => {
  const { response, body } = await postCalculation({ expression: '2 +' });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'Please enter a valid expression.');
});

test('POST /calculate rejects invalid expression characters', async () => {
  const { response, body } = await postCalculation({ expression: '2abc + 3' });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'Please enter a valid expression.');
});

test('POST /calculate rejects non-finite expression results', async () => {
  const { response, body } = await postCalculation({ expression: '1 / 0' });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'Calculation produced an invalid result.');
});

test('POST /calculate rejects missing or non-numeric operands', async () => {
  for (const requestBody of [
    { operation: '+' },
    { a: 'not-a-number', b: 3, operation: '+' }
  ]) {
    const { response, body } = await postCalculation(requestBody);
    assert.equal(response.status, 400);
    assert.equal(body.error, 'Please enter valid numbers.');
  }
});

test('POST /calculate rejects an unsupported legacy operation', async () => {
  const { response, body } = await postCalculation({ a: 7, b: 3, operation: '^' });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'Unsupported operation.');
});

test('POST /calculate rejects legacy division by zero', async () => {
  const { response, body } = await postCalculation({ a: 7, b: 0, operation: '/' });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'Cannot divide by zero.');
});

test('POST /calculate rejects malformed JSON', async () => {
  const response = await fetch(`${baseUrl}/calculate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"expression":'
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, 'Please provide valid JSON.');
});

test('GET / serves the calculator page', async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.match(body, /CougarCalc/);
});

test('GET /environment returns the active environment label', async () => {
  const response = await fetch(`${baseUrl}/environment`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    environment: getEnvironmentLabel(process.env.NODE_ENV || 'development')
  });
});

test('environment labels distinguish production from development', () => {
  assert.equal(getEnvironmentLabel('production'), 'Production');
  assert.equal(getEnvironmentLabel('development'), 'Development');
  assert.equal(getEnvironmentLabel(undefined), 'Development');
});

test('an unknown route returns 404', async () => {
  const response = await fetch(`${baseUrl}/does-not-exist`);

  assert.equal(response.status, 404);
});
