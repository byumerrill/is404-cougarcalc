const test = require('node:test');
const assert = require('node:assert/strict');
const { UNSAVED_WARNING, createApp, startServer } = require('../app');
const {
  createUnavailableRepository,
  readDatabaseConfig
} = require('../database');
const { createDatabaseDiagnostics } = require('../database-diagnostics');
const {
  HISTORY_COOKIE_MAX_AGE_SECONDS,
  HISTORY_COOKIE_NAME,
  TOKEN_PATTERN,
  hashHistoryToken
} = require('../browser-identity');

function toPublicCalculation(calculation) {
  return {
    id: calculation.id,
    timestamp: calculation.timestamp,
    expression: calculation.expression,
    result: calculation.result
  };
}

function createFakeRepository(overrides = {}) {
  const calculations = [];

  return {
    calculations,

    async checkReadiness() {
      return true;
    },

    async saveCalculation(calculation) {
      calculations.unshift({
        id: calculations.length + 1,
        timestamp: new Date('2026-07-24T18:00:00Z'),
        ...calculation
      });
      return toPublicCalculation(calculations[0]);
    },

    async getHistory(browserTokenHash) {
      return calculations
        .filter(
          (calculation) =>
            calculation.browserTokenHash === browserTokenHash
        )
        .map(toPublicCalculation);
    },

    ...overrides
  };
}

async function withServer(repository, callback, options = {}) {
  const app = createApp({ repository, ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postCalculation(baseUrl, body) {
  const response = await fetch(`${baseUrl}/calculate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const responseBody = await response.json();
  return { response, body: responseBody };
}

function createBrowserClient(baseUrl) {
  let cookie;

  return {
    clearCookie() {
      cookie = undefined;
    },

    get cookie() {
      return cookie;
    },

    async fetch(pathname, options = {}) {
      const headers = new Headers(options.headers);
      if (cookie) {
        headers.set('cookie', cookie);
      }

      const response = await fetch(`${baseUrl}${pathname}`, {
        ...options,
        headers
      });
      const setCookieHeader = response.headers.get('set-cookie');
      if (setCookieHeader) {
        cookie = setCookieHeader.split(';', 1)[0];
      }

      return response;
    },

    async postCalculation(body) {
      const response = await this.fetch('/calculate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { response, body: await response.json() };
    }
  };
}

test('POST /calculate evaluates and saves an expression before responding', async () => {
  const repository = createFakeRepository();

  await withServer(repository, async (baseUrl) => {
    const { response, body } = await postCalculation(baseUrl, {
      expression: '2 + 3 * 4'
    });

    assert.equal(response.status, 200);
    assert.deepEqual(body, { result: 14 });
    const saved = repository.calculations[0];
    assert.match(saved.browserTokenHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(toPublicCalculation(saved), {
      id: 1,
      timestamp: new Date('2026-07-24T18:00:00Z'),
      expression: '2 + 3 * 4',
      result: 14
    });
  });
});

test('the homepage establishes a persistent HTTP history cookie', async () => {
  await withServer(createFakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const setCookieHeader = response.headers.get('set-cookie');

    assert.equal(response.status, 200);
    assert.match(
      setCookieHeader,
      new RegExp(`^${HISTORY_COOKIE_NAME}=([A-Za-z0-9_-]{43});`)
    );
    assert.match(
      setCookieHeader,
      new RegExp(`Max-Age=${HISTORY_COOKIE_MAX_AGE_SECONDS}`)
    );
    assert.match(setCookieHeader, /; Path=\//);
    assert.match(setCookieHeader, /; HttpOnly/);
    assert.match(setCookieHeader, /; SameSite=Lax/);
    assert.equal(setCookieHeader.includes('Secure'), false);
  });
});

test('HTTPS history cookie mode adds Secure', async () => {
  await withServer(
    createFakeRepository(),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/`);
      assert.match(response.headers.get('set-cookie'), /; Secure$/);
    },
    { historyCookieSecure: true }
  );
});

test('a valid browser cookie is reused without exposing identifiers', async () => {
  const repository = createFakeRepository();

  await withServer(repository, async (baseUrl) => {
    const browser = createBrowserClient(baseUrl);
    const pageResponse = await browser.fetch('/');
    const token = browser.cookie.split('=', 2)[1];
    assert.match(token, TOKEN_PATTERN);

    const { response, body } = await browser.postCalculation({
      expression: '8 * 8'
    });
    const historyResponse = await browser.fetch('/history');
    const historyBody = await historyResponse.json();
    const storedHash = repository.calculations[0].browserTokenHash;

    assert.equal(pageResponse.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(historyResponse.headers.get('set-cookie'), null);
    assert.deepEqual(body, { result: 64 });
    assert.equal(JSON.stringify(body).includes(token), false);
    assert.equal(JSON.stringify(body).includes(storedHash), false);
    assert.equal(JSON.stringify(historyBody).includes(token), false);
    assert.equal(JSON.stringify(historyBody).includes(storedHash), false);
    assert.equal(storedHash, hashHistoryToken(token));
  });
});

test('different browser cookies receive isolated persistent histories', async () => {
  const repository = createFakeRepository();

  await withServer(repository, async (baseUrl) => {
    const chrome = createBrowserClient(baseUrl);
    const edge = createBrowserClient(baseUrl);

    await chrome.postCalculation({ expression: '1 + 1' });
    await edge.postCalculation({ expression: '3 * 3' });
    await chrome.postCalculation({ expression: '2 + 2' });

    const chromeHistoryResponse = await chrome.fetch('/history');
    const edgeHistoryResponse = await edge.fetch('/history');

    assert.deepEqual(
      (await chromeHistoryResponse.json()).map(({ expression }) => expression),
      ['2 + 2', '1 + 1']
    );
    assert.deepEqual(
      (await edgeHistoryResponse.json()).map(({ expression }) => expression),
      ['3 * 3']
    );

    chrome.clearCookie();
    const newChromeHistory = await chrome.fetch('/history');
    assert.deepEqual(await newChromeHistory.json(), []);

    const unchangedEdgeHistory = await edge.fetch('/history');
    assert.deepEqual(
      (await unchangedEdgeHistory.json()).map(({ expression }) => expression),
      ['3 * 3']
    );
  });
});

// A restart creates a new Express instance with no in-memory browser state. The
// retained cookie must be sufficient to recover history from persistent storage.
test('browser-scoped history survives an application restart', async () => {
  const persistentRepository = createFakeRepository();
  let retainedCookie;

  await withServer(persistentRepository, async (baseUrl) => {
    const browser = createBrowserClient(baseUrl);
    const { response } = await browser.postCalculation({ expression: '6 * 7' });

    assert.equal(response.status, 200);
    retainedCookie = browser.cookie;
  });

  await withServer(persistentRepository, async (baseUrl) => {
    const returningBrowserResponse = await fetch(`${baseUrl}/history`, {
      headers: { cookie: retainedCookie }
    });
    const newBrowserResponse = await fetch(`${baseUrl}/history`);

    assert.equal(returningBrowserResponse.headers.get('set-cookie'), null);
    assert.deepEqual(await returningBrowserResponse.json(), [
      {
        id: 1,
        timestamp: '2026-07-24T18:00:00.000Z',
        expression: '6 * 7',
        result: 42
      }
    ]);
    assert.deepEqual(await newBrowserResponse.json(), []);
    assert.match(
      newBrowserResponse.headers.get('set-cookie'),
      new RegExp(`^${HISTORY_COOKIE_NAME}=[A-Za-z0-9_-]{43};`)
    );
  });
});

test('a malformed browser cookie is replaced safely', async () => {
  await withServer(createFakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/history`, {
      headers: { cookie: `${HISTORY_COOKIE_NAME}=malformed` }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    assert.match(
      response.headers.get('set-cookie'),
      new RegExp(`^${HISTORY_COOKIE_NAME}=[A-Za-z0-9_-]{43};`)
    );
  });
});

test('POST /calculate preserves parentheses, negative numbers, and decimal rounding', async () => {
  const repository = createFakeRepository();

  await withServer(repository, async (baseUrl) => {
    const parentheses = await postCalculation(baseUrl, {
      expression: '(2 + 3) * -4'
    });
    const decimal = await postCalculation(baseUrl, {
      expression: '0.1 + 0.2'
    });

    assert.deepEqual(parentheses.body, { result: -20 });
    assert.deepEqual(decimal.body, { result: 0.3 });
  });
});

test('POST /calculate preserves and saves each legacy arithmetic operation', async () => {
  const repository = createFakeRepository();
  const cases = [
    { operation: '+', expected: 10 },
    { operation: '-', expected: 4 },
    { operation: '*', expected: 21 },
    { operation: '/', expected: 7 / 3 }
  ];

  await withServer(repository, async (baseUrl) => {
    for (const { operation, expected } of cases) {
      const { response, body } = await postCalculation(baseUrl, {
        a: 7,
        b: 3,
        operation
      });

      assert.equal(response.status, 200);
      assert.equal(body.result, expected);
    }

    assert.deepEqual(
      repository.calculations.map(({ expression }) => expression),
      ['7 / 3', '7 * 3', '7 - 3', '7 + 3']
    );
  });
});

test('invalid expression requests retain their errors and are not saved', async () => {
  const repository = createFakeRepository();

  await withServer(repository, async (baseUrl) => {
    const cases = [
      {
        body: { expression: '   ' },
        error: 'Please enter a valid expression.'
      },
      {
        body: { expression: '2 +' },
        error: 'Please enter a valid expression.'
      },
      {
        body: { expression: '2abc + 3' },
        error: 'Please enter a valid expression.'
      },
      {
        body: { expression: '1 / 0' },
        error: 'Calculation produced an invalid result.'
      }
    ];

    for (const testCase of cases) {
      const { response, body } = await postCalculation(baseUrl, testCase.body);
      assert.equal(response.status, 400);
      assert.equal(body.error, testCase.error);
    }

    assert.deepEqual(repository.calculations, []);
  });
});

test('invalid legacy requests retain their errors and are not saved', async () => {
  const repository = createFakeRepository();

  await withServer(repository, async (baseUrl) => {
    const cases = [
      {
        body: { operation: '+' },
        error: 'Please enter valid numbers.'
      },
      {
        body: { a: 'not-a-number', b: 3, operation: '+' },
        error: 'Please enter valid numbers.'
      },
      {
        body: { a: 7, b: 3, operation: '^' },
        error: 'Unsupported operation.'
      },
      {
        body: { a: 7, b: 0, operation: '/' },
        error: 'Cannot divide by zero.'
      }
    ];

    for (const testCase of cases) {
      const { response, body } = await postCalculation(baseUrl, testCase.body);
      assert.equal(response.status, 400);
      assert.equal(body.error, testCase.error);
    }

    assert.deepEqual(repository.calculations, []);
  });
});

test('malformed JSON is rejected and not saved', async () => {
  const repository = createFakeRepository();

  await withServer(repository, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/calculate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"expression":'
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Please provide valid JSON.'
    });
    assert.deepEqual(repository.calculations, []);
  });
});

test('a persistence failure returns the result with an explicit unsaved warning', async () => {
  const databaseErrors = [];
  let rejectedHash;
  const repository = createFakeRepository({
    async saveCalculation(calculation) {
      rejectedHash = calculation.browserTokenHash;
      throw new Error(
        `password authentication failed for history hash ${rejectedHash}`
      );
    }
  });

  await withServer(
    repository,
    async (baseUrl) => {
      const browser = createBrowserClient(baseUrl);
      const { response, body } = await browser.postCalculation({
        expression: '1 + 1'
      });
      const token = browser.cookie.split('=', 2)[1];

      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        result: 2,
        saved: false,
        warning: UNSAVED_WARNING
      });
      assert.equal(JSON.stringify(body).includes(token), false);
      assert.equal(JSON.stringify(body).includes(rejectedHash), false);
      assert.equal(JSON.stringify(databaseErrors).includes(token), false);
      assert.equal(JSON.stringify(databaseErrors).includes(rejectedHash), false);
      assert.deepEqual(databaseErrors, ['save_calculation']);
    },
    { onDatabaseError: (context) => databaseErrors.push(context) }
  );
});

test('health endpoints are small, database-aware, and never set history cookies', async () => {
  const repository = createFakeRepository();

  await withServer(repository, async (baseUrl) => {
    const liveResponse = await fetch(`${baseUrl}/health/live`);
    const readyResponse = await fetch(`${baseUrl}/health/ready`);

    assert.equal(liveResponse.status, 200);
    assert.deepEqual(await liveResponse.json(), { status: 'live' });
    assert.equal(readyResponse.status, 200);
    assert.deepEqual(await readyResponse.json(), { status: 'ready' });
    assert.equal(liveResponse.headers.get('set-cookie'), null);
    assert.equal(readyResponse.headers.get('set-cookie'), null);
  });

  await withServer(createUnavailableRepository(), async (baseUrl) => {
    const liveResponse = await fetch(`${baseUrl}/health/live`);
    const readyResponse = await fetch(`${baseUrl}/health/ready`);

    assert.equal(liveResponse.status, 200);
    assert.equal(readyResponse.status, 503);
    assert.deepEqual(await readyResponse.json(), { status: 'not ready' });
    assert.equal(readyResponse.headers.get('set-cookie'), null);
  });
});

test('readiness safely returns 503 for connection, schema, and permission failures', async () => {
  const failureDetails = [
    'connection refused at private-db.internal',
    'relation calculation_history does not exist',
    'permission denied for secret application role'
  ];

  for (const detail of failureDetails) {
    const databaseErrors = [];
    const repository = createFakeRepository({
      async checkReadiness() {
        throw new Error(detail);
      }
    });

    await withServer(
      repository,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health/ready`);
        const body = await response.json();

        assert.equal(response.status, 503);
        assert.deepEqual(body, { status: 'not ready' });
        assert.equal(JSON.stringify(body).includes(detail), false);
        assert.equal(response.headers.get('set-cookie'), null);
        assert.deepEqual(databaseErrors, ['readiness_check']);
      },
      { onDatabaseError: (context) => databaseErrors.push(context) }
    );
  }
});

test('instance diagnostics expose only a deterministic short marker', async () => {
  await withServer(
    createFakeRepository(),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/diagnostics/instance`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.match(body.instance, /^[0-9a-f]{12}$/);
      assert.equal(response.headers.get('x-cougarcalc-instance'), body.instance);
      assert.equal(JSON.stringify(body).includes('test-private-hostname'), false);
      assert.equal(response.headers.get('set-cookie'), null);

      const pageResponse = await fetch(`${baseUrl}/environment`);
      assert.equal(
        pageResponse.headers.get('x-cougarcalc-instance'),
        body.instance
      );
    },
    { hostnameSource: () => 'test-private-hostname' }
  );
});

test('GET /history returns repository history as JSON', async () => {
  const history = [
    {
      id: 2,
      timestamp: new Date('2026-07-24T18:01:00Z'),
      expression: '3 * 4',
      result: 12
    },
    {
      id: 1,
      timestamp: new Date('2026-07-24T18:00:00Z'),
      expression: '1 + 1',
      result: 2
    }
  ];
  const repository = createFakeRepository({
    async getHistory() {
      return history;
    }
  });

  await withServer(repository, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/history`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [
      {
        id: 2,
        timestamp: '2026-07-24T18:01:00.000Z',
        expression: '3 * 4',
        result: 12
      },
      {
        id: 1,
        timestamp: '2026-07-24T18:00:00.000Z',
        expression: '1 + 1',
        result: 2
      }
    ]);
  });
});

test('GET /history returns an empty array when no calculations exist', async () => {
  await withServer(createFakeRepository(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/history`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
});

test('GET /history returns a safe service error when the database fails', async () => {
  const databaseErrors = [];
  const repository = createFakeRepository({
    async getHistory() {
      throw new Error('SELECT failed with secret details');
    }
  });

  await withServer(
    repository,
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/history`);
      const body = await response.json();

      assert.equal(response.status, 503);
      assert.deepEqual(body, {
        error: 'Calculation history is temporarily unavailable.'
      });
      assert.equal(JSON.stringify(body).includes('secret'), false);
      assert.deepEqual(databaseErrors, ['retrieve_history']);
    },
    { onDatabaseError: (context) => databaseErrors.push(context) }
  );
});

test('existing page, environment, static security, and 404 behavior is preserved', async () => {
  await withServer(
    createFakeRepository(),
    async (baseUrl) => {
      const pageResponse = await fetch(`${baseUrl}/`);
      const environmentResponse = await fetch(`${baseUrl}/environment`);
      const environmentFileResponse = await fetch(`${baseUrl}/.env.example`);
      const databaseFileResponse = await fetch(`${baseUrl}/database.js`);
      const missingResponse = await fetch(`${baseUrl}/does-not-exist`);

      assert.equal(pageResponse.status, 200);
      const page = await pageResponse.text();
      assert.match(page, /CougarCalc/);
      assert.match(page, /id="persistenceStatus"/);
      assert.match(page, /role="status"/);
      assert.match(page, /aria-live="polite"/);
      assert.deepEqual(await environmentResponse.json(), {
        environment: 'staging'
      });
      assert.equal(environmentFileResponse.status, 404);
      assert.equal(databaseFileResponse.status, 404);
      assert.equal(missingResponse.status, 404);
    },
    { nodeEnv: 'staging' }
  );
});

test('startup with no database configuration serves degraded calculator and health', async () => {
  const logEntries = [];
  const logger = {
    log(message) {
      logEntries.push(message);
    },
    warn(message) {
      logEntries.push(message);
    },
    error(message) {
      logEntries.push(message);
    }
  };
  const started = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      NODE_ENV: 'test',
      HISTORY_COOKIE_SECURE: 'false'
    },
    { logger, hostnameSource: () => 'degraded-test-host' }
  );

  try {
    const baseUrl = `http://127.0.0.1:${started.server.address().port}`;
    const liveResponse = await fetch(`${baseUrl}/health/live`);
    const readyResponse = await fetch(`${baseUrl}/health/ready`);
    const calculation = await postCalculation(baseUrl, {
      expression: '2 + 3 * 4'
    });

    assert.equal(liveResponse.status, 200);
    assert.equal(readyResponse.status, 503);
    assert.equal(calculation.response.status, 200);
    assert.deepEqual(calculation.body, {
      result: 14,
      saved: false,
      warning: UNSAVED_WARNING
    });
    assert.match(logEntries[0], /DATABASE_HOST/);
    assert.match(logEntries[0], /DATABASE_PASSWORD/);
  } finally {
    await new Promise((resolve, reject) => {
      started.server.close((error) => (error ? reject(error) : resolve()));
    });
    await started.repository.close();
  }
});

test('partial and invalid database configuration starts safely without leaking values', async () => {
  const secret = 'password-that-must-never-appear';
  const endpoint = 'private-db.internal.example';
  const scenarios = [
    {
      env: { DATABASE_HOST: endpoint, DATABASE_PASSWORD: secret },
      expectedLog: /DATABASE_PORT,DATABASE_NAME,DATABASE_USER/
    },
    {
      env: {
        DATABASE_HOST: endpoint,
        DATABASE_PORT: 'invalid-secret-port',
        DATABASE_NAME: 'cougarcalc',
        DATABASE_USER: 'cougarcalc_app',
        DATABASE_PASSWORD: secret
      },
      expectedLog: /configuration_invalid category=configuration_invalid/
    }
  ];

  for (const scenario of scenarios) {
    const logEntries = [];
    const logger = {
      log: (message) => logEntries.push(message),
      warn: (message) => logEntries.push(message),
      error: (message) => logEntries.push(message)
    };
    const started = await startServer(
      {
        ...scenario.env,
        HOST: '127.0.0.1',
        PORT: '0',
        HISTORY_COOKIE_SECURE: 'false'
      },
      { logger, hostnameSource: () => 'safe-log-test-host' }
    );

    try {
      const baseUrl = `http://127.0.0.1:${started.server.address().port}`;
      const response = await fetch(`${baseUrl}/health/ready`);
      assert.equal(response.status, 503);
      assert.match(logEntries[0], scenario.expectedLog);
      assert.equal(JSON.stringify(logEntries).includes(secret), false);
      assert.equal(JSON.stringify(logEntries).includes(endpoint), false);
      assert.equal(JSON.stringify(await response.json()).includes(secret), false);
    } finally {
      await new Promise((resolve, reject) => {
        started.server.close((error) => (error ? reject(error) : resolve()));
      });
      await started.repository.close();
    }
  }
});

test('structured Secrets Manager password starts degraded with only a safe category', async () => {
  const innerSecret = 'DO_NOT_LOG_INNER_SECRET_67890';
  const structuredSecret = JSON.stringify({
    username: 'cougarcalc_app',
    password: innerSecret
  });
  const logEntries = [];
  let repositoryCreated = false;
  const logger = {
    log: (message) => logEntries.push(message),
    warn: (message) => logEntries.push(message),
    error: (message) => logEntries.push(message)
  };
  const env = {
    HOST: '127.0.0.1',
    PORT: '0',
    HISTORY_COOKIE_SECURE: 'false',
    DATABASE_HOST: 'db.internal.test',
    DATABASE_PORT: '5432',
    DATABASE_NAME: 'cougarcalc',
    DATABASE_USER: 'cougarcalc_app',
    DATABASE_PASSWORD: structuredSecret,
    DATABASE_TLS_MODE: 'disable'
  };

  const started = await startServer(env, {
    createPool(receivedEnv) {
      readDatabaseConfig(receivedEnv);
      throw new Error('unreachable');
    },
    createRepository() {
      repositoryCreated = true;
    },
    logger,
    hostnameSource: () => 'structured-secret-test-host'
  });

  try {
    const baseUrl = `http://127.0.0.1:${started.server.address().port}`;
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
  } finally {
    await new Promise((resolve, reject) => {
      started.server.close((error) => (error ? reject(error) : resolve()));
    });
    await started.repository.close();
  }

  assert.equal(repositoryCreated, false);
  assert.match(
    logEntries[0],
    /configuration_invalid category=database_password_is_structured_value/
  );
  assert.equal(JSON.stringify(logEntries).includes(structuredSecret), false);
  assert.equal(JSON.stringify(logEntries).includes(innerSecret), false);
});

test('runtime database diagnostics exclude request, cookie, token-hash, and password data', async () => {
  const expression = '987654 + 123456';
  const browserToken = 'A'.repeat(43);
  const browserTokenHash = hashHistoryToken(browserToken);
  const password = 'DO_NOT_LOG_THIS_DATABASE_PASSWORD_12345';
  const logEntries = [];
  const databaseDiagnostics = createDatabaseDiagnostics({
    logger: {
      log: (message) => logEntries.push(message),
      warn: (message) => logEntries.push(message),
      error: (message) => logEntries.push(message)
    },
    instanceMarker: 'abc123def456'
  });
  const repository = createFakeRepository({
    async saveCalculation() {
      const error = new Error(
        `${expression} ${browserToken} ${browserTokenHash} ${password}`
      );
      error.code = 'ETIMEDOUT';
      throw error;
    },
    async getHistory() {
      const error = new Error(`${browserTokenHash} ${password}`);
      error.code = '08006';
      throw error;
    }
  });

  await withServer(
    repository,
    async (baseUrl) => {
      await fetch(`${baseUrl}/calculate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${HISTORY_COOKIE_NAME}=${browserToken}`
        },
        body: JSON.stringify({ expression })
      });
      await fetch(`${baseUrl}/history`, {
        headers: { cookie: `${HISTORY_COOKIE_NAME}=${browserToken}` }
      });
    },
    { databaseDiagnostics }
  );

  assert.match(logEntries[0], /operation=save_calculation/);
  assert.match(logEntries[1], /operation=retrieve_history/);
  for (const privateValue of [
    expression,
    browserToken,
    browserTokenHash,
    password
  ]) {
    assert.equal(JSON.stringify(logEntries).includes(privateValue), false);
  }
});

test('configured but unavailable PostgreSQL starts degraded and can recover', async () => {
  const events = [];
  let ready = false;
  const repository = createFakeRepository({
    async checkReadiness() {
      events.push('readiness');
      return ready;
    }
  });
  const logger = {
    log: (message) => events.push(message),
    warn: (message) => events.push(message),
    error: (message) => events.push(message)
  };
  const started = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      HISTORY_COOKIE_SECURE: 'false',
      DATABASE_HOST: 'db.internal.test',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'cougarcalc',
      DATABASE_USER: 'cougarcalc_app',
      DATABASE_PASSWORD: 'never-log-this'
    },
    {
      createPool: () => ({}),
      createRepository: () => repository,
      logger,
      hostnameSource: () => 'recovery-test-host'
    }
  );

  try {
    const baseUrl = `http://127.0.0.1:${started.server.address().port}`;
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
    ready = true;
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 200);
  } finally {
    await new Promise((resolve, reject) => {
      started.server.close((error) => (error ? reject(error) : resolve()));
    });
    await started.repository.close?.();
  }

  assert.equal(JSON.stringify(events).includes('never-log-this'), false);
  assert.equal(
    events.filter((event) => String(event).includes('readiness_failed')).length,
    1
  );
  assert.equal(
    events.filter((event) => String(event).includes('readiness_recovered')).length,
    1
  );
  assert.equal(
    events.some(
      (event) =>
        String(event).includes('readiness_recovered') &&
        String(event).includes('instance=')
    ),
    true
  );
});

// This exercises the complete successful startup path rather than creating the
// Express app directly. It proves readiness precedes listening and that cookie
// configuration is passed through to real HTTP responses.
test('successful startup verifies readiness and propagates secure-cookie configuration', async () => {
  const events = [];
  const pool = { kind: 'fake-pool' };
  let closeCount = 0;
  const repository = {
    async verifyConnection() {
      events.push('verify connection');
    },
    async verifySchema() {
      events.push('verify schema');
      return true;
    },
    async checkReadiness() {
      await this.verifyConnection();
      return this.verifySchema();
    },
    async getHistory() {
      return [];
    },
    async saveCalculation() {},
    async close() {
      closeCount += 1;
    }
  };
  const env = {
    HOST: '127.0.0.1',
    PORT: '0',
    NODE_ENV: 'test',
    HISTORY_COOKIE_SECURE: 'true',
    DATABASE_HOST: 'db.internal.test',
    DATABASE_PORT: '5432',
    DATABASE_NAME: 'cougarcalc',
    DATABASE_USER: 'cougarcalc_app',
    DATABASE_PASSWORD: 'test-only-placeholder'
  };

  const started = await startServer(env, {
    createPool(receivedEnv) {
      assert.equal(receivedEnv, env);
      events.push('create pool');
      return pool;
    },
    createRepository(receivedPool) {
      assert.equal(receivedPool, pool);
      events.push('create repository');
      return repository;
    },
    hostnameSource: () => 'successful-start-test-host'
  });

  try {
    const baseUrl = `http://127.0.0.1:${started.server.address().port}`;
    const pageResponse = await fetch(`${baseUrl}/`);
    const environmentResponse = await fetch(`${baseUrl}/environment`);

    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers.get('set-cookie'), /; Secure$/);
    assert.deepEqual(await environmentResponse.json(), { environment: 'test' });
    assert.deepEqual(events, [
      'create pool',
      'create repository',
      'verify connection',
      'verify schema'
    ]);
    assert.equal(closeCount, 0);
  } finally {
    await new Promise((resolve, reject) => {
      started.server.close((error) => (error ? reject(error) : resolve()));
    });
    await started.repository.close();
  }

  assert.equal(closeCount, 1);
});

// Invalid cookie configuration should fail before a pool is allocated, which
// avoids opening database resources for a process that cannot start correctly.
test('startup rejects invalid secure-cookie configuration before creating a pool', async () => {
  let poolCreated = false;

  await assert.rejects(
    () =>
      startServer(
        { HISTORY_COOKIE_SECURE: 'TRUE' },
        {
          createPool() {
            poolCreated = true;
            return {};
          }
        }
      ),
    /HISTORY_COOKIE_SECURE must be either true or false/
  );

  assert.equal(poolCreated, false);
});
