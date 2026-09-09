const assert = require('node:assert/strict');
const { UNSAVED_WARNING, startServer } = require('../app');

async function runDegradedSmoke() {
  const started = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      NODE_ENV: 'smoke',
      HISTORY_COOKIE_SECURE: 'false'
    },
    { hostnameSource: () => 'degraded-smoke-host' }
  );
  const baseUrl = `http://127.0.0.1:${started.server.address().port}`;

  try {
    const liveResponse = await fetch(`${baseUrl}/health/live`);
    const readyResponse = await fetch(`${baseUrl}/health/ready`);
    const calculationResponse = await fetch(`${baseUrl}/calculate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expression: '2 + 3 * 4' })
    });
    const calculation = await calculationResponse.json();

    assert.equal(liveResponse.status, 200);
    assert.deepEqual(await liveResponse.json(), { status: 'live' });
    assert.equal(readyResponse.status, 503);
    assert.deepEqual(await readyResponse.json(), { status: 'not ready' });
    assert.equal(calculationResponse.status, 200);
    assert.deepEqual(calculation, {
      result: 14,
      saved: false,
      warning: UNSAVED_WARNING
    });

    console.log(
      JSON.stringify({
        node: process.version,
        liveness: 200,
        readiness: 503,
        calculation: { result: calculation.result, saved: calculation.saved }
      })
    );
  } finally {
    await new Promise((resolve, reject) => {
      started.server.close((error) => (error ? reject(error) : resolve()));
    });
    await started.repository.close();
  }
}

runDegradedSmoke().catch((error) => {
  console.error(`Degraded smoke check failed: ${error.message}`);
  process.exitCode = 1;
});
