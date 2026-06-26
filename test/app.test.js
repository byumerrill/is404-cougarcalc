const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../app');

test('POST /calculate returns the correct result for an expression', async () => {
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/calculate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expression: '7 + 3' })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result, 10);
  } finally {
    server.close();
  }
});

test('POST /calculate returns the correct result for addition', async () => {
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/calculate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 7, b: 3, operation: '+' })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result, 10);
  } finally {
    server.close();
  }
});
