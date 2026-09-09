const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { startServer } = require('../app');

const pgCtl = process.env.RELEASE_TEST_PG_CTL;
const dataDirectory = process.env.RELEASE_TEST_PG_DATA;
const logPath = process.env.RELEASE_TEST_PG_LOG;
const port = process.env.RELEASE_TEST_PG_PORT || '65432';

if (!pgCtl || !dataDirectory || !logPath) {
  throw new Error('Disposable PostgreSQL control settings are required.');
}

function controlPostgres(action) {
  const args = ['-D', dataDirectory];
  if (action === 'start') {
    args.push('-l', logPath, '-o', `-p ${port} -h 127.0.0.1`, '-w', '-t', '30');
  } else {
    args.push('-m', 'fast', '-w', '-t', '30');
  }
  args.push(action);
  execFileSync(pgCtl, args, { stdio: 'ignore' });
}

async function getJson(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json() };
}

async function runPostgresRecoverySmoke() {
  const started = await startServer({
    HOST: '127.0.0.1',
    PORT: '0',
    NODE_ENV: 'release-smoke',
    HISTORY_COOKIE_SECURE: 'false',
    DATABASE_HOST: '127.0.0.1',
    DATABASE_PORT: port,
    DATABASE_NAME: 'cougarcalc_release3',
    DATABASE_USER: 'cougarcalc_app_release3',
    DATABASE_PASSWORD: 'release03-disposable-test-only',
    DATABASE_TLS_MODE: 'disable'
  });
  const baseUrl = `http://127.0.0.1:${started.server.address().port}`;
  let postgresRunning = true;

  try {
    const live = await getJson(baseUrl, '/health/live');
    const ready = await getJson(baseUrl, '/health/ready');
    assert.equal(live.response.status, 200);
    assert.equal(ready.response.status, 200);

    const first = await getJson(baseUrl, '/calculate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expression: '6 * 7' })
    });
    assert.equal(first.response.status, 200);
    assert.deepEqual(first.body, { result: 42 });
    const cookie = first.response.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie);

    const history = await getJson(baseUrl, '/history', {
      headers: { cookie }
    });
    assert.equal(history.response.status, 200);
    assert.equal(history.body[0].expression, '6 * 7');
    assert.equal(history.body[0].result, 42);

    controlPostgres('stop');
    postgresRunning = false;

    const unavailableReady = await getJson(baseUrl, '/health/ready');
    const unavailableCalculation = await getJson(baseUrl, '/calculate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie
      },
      body: JSON.stringify({ expression: '9 * 9' })
    });
    assert.equal(unavailableReady.response.status, 503);
    assert.equal(unavailableCalculation.response.status, 200);
    assert.equal(unavailableCalculation.body.result, 81);
    assert.equal(unavailableCalculation.body.saved, false);

    controlPostgres('start');
    postgresRunning = true;

    const recoveredReady = await getJson(baseUrl, '/health/ready');
    const recoveredCalculation = await getJson(baseUrl, '/calculate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie
      },
      body: JSON.stringify({ expression: '10 * 10' })
    });
    const recoveredHistory = await getJson(baseUrl, '/history', {
      headers: { cookie }
    });
    assert.equal(recoveredReady.response.status, 200);
    assert.deepEqual(recoveredCalculation.body, { result: 100 });
    assert.deepEqual(
      recoveredHistory.body.map(({ expression }) => expression),
      ['10 * 10', '6 * 7']
    );

    console.log(
      JSON.stringify({
        ready: 200,
        saved: 42,
        outageReady: 503,
        outageResult: 81,
        outageSaved: false,
        recoveredReady: 200,
        recoveredSaved: 100,
        unsavedCalculationRecovered: false
      })
    );
  } finally {
    await new Promise((resolve, reject) => {
      started.server.close((error) => (error ? reject(error) : resolve()));
    });
    await started.repository.close();
    if (!postgresRunning) {
      controlPostgres('start');
    }
  }
}

const keepProcessAlive = setInterval(() => {}, 1_000);

(async () => {
  try {
    await runPostgresRecoverySmoke();
  } catch (error) {
    console.error(`PostgreSQL recovery smoke failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    clearInterval(keepProcessAlive);
  }
})().then(() => {}, () => {});
