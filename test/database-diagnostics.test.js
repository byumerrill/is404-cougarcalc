const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyDatabaseError,
  createDatabaseDiagnostics,
  createSafeDatabaseError
} = require('../database-diagnostics');

function createCapturedDiagnostics({ now } = {}) {
  const entries = [];
  const logger = {
    log: (message) => entries.push(message),
    warn: (message) => entries.push(message),
    error: (message) => entries.push(message)
  };
  return {
    diagnostics: createDatabaseDiagnostics({
      logger,
      instanceMarker: 'abc123def456',
      now
    }),
    entries
  };
}

test('database errors use stable Node and PostgreSQL codes', () => {
  const scenarios = [
    ['ENOTFOUND', 'dns_failure', true],
    ['ECONNREFUSED', 'connection_refused', true],
    ['ETIMEDOUT', 'connection_timeout', true],
    ['28P01', 'authentication_failed', false],
    ['3D000', 'database_not_found', false],
    ['42501', 'insufficient_privilege', false],
    ['42P01', 'schema_missing_or_invalid', false],
    ['08006', 'connection_failure', true]
  ];

  for (const [code, category, retryable] of scenarios) {
    assert.deepEqual(classifyDatabaseError({ code }), {
      category,
      code,
      retryable
    });
  }
});

test('unknown database errors expose only a bounded simple code', () => {
  assert.deepEqual(classifyDatabaseError({ code: 'SIMPLE_1' }), {
    category: 'unexpected_database_error',
    code: 'SIMPLE_1',
    retryable: false
  });
  assert.deepEqual(
    classifyDatabaseError({ code: 'unsafe code password=do-not-log' }),
    { category: 'unexpected_database_error', retryable: false }
  );
});

test('structured password misuse has a dedicated safe classification', () => {
  assert.deepEqual(
    classifyDatabaseError(
      createSafeDatabaseError('COUGARCALC_DATABASE_PASSWORD_STRUCTURED')
    ),
    {
      category: 'database_password_is_structured_value',
      retryable: false
    }
  );
});

test('diagnostics never serialize raw errors and bound repeated failures', () => {
  let currentTime = 1_000;
  const { diagnostics, entries } = createCapturedDiagnostics({
    now: () => currentTime
  });
  const sentinel = 'DO_NOT_LOG_THIS_DATABASE_PASSWORD_12345';
  const rawError = new Error(`password=${sentinel}`);
  rawError.code = 'ETIMEDOUT';
  rawError.connectionParameters = { password: sentinel };

  diagnostics.readinessFailed('connection', rawError);
  diagnostics.readinessFailed('connection', rawError);
  diagnostics.operationFailed('save_calculation', rawError);
  diagnostics.operationFailed('save_calculation', rawError);
  diagnostics.idleConnectionFailed(rawError);
  diagnostics.idleConnectionFailed(rawError);

  assert.equal(entries.length, 3);
  assert.match(entries[0], /readiness_failed stage=connection/);
  assert.match(entries[1], /operation=save_calculation/);
  assert.match(entries[2], /idle_connection_failed/);
  assert.equal(entries.every((entry) => entry.includes('category=connection_timeout')), true);
  assert.equal(entries.every((entry) => entry.includes('code=ETIMEDOUT')), true);
  assert.equal(JSON.stringify(entries).includes(sentinel), false);
  assert.equal(JSON.stringify(entries).includes('connectionParameters'), false);

  currentTime = 2_250;
  diagnostics.readinessRecovered();
  diagnostics.readinessRecovered();
  diagnostics.operationRecovered('save_calculation');
  diagnostics.operationRecovered('save_calculation');

  assert.match(entries[3], /readiness_recovered elapsed_ms=1250/);
  assert.match(entries[4], /operation_recovered operation=save_calculation/);
  assert.equal(entries[3].includes('instance=abc123def456'), true);
  assert.equal(entries.length, 5);
});

test('a changed failure category is logged even before recovery', () => {
  const { diagnostics, entries } = createCapturedDiagnostics();

  diagnostics.operationFailed('retrieve_history', { code: 'ETIMEDOUT' });
  diagnostics.operationFailed('retrieve_history', { code: '28P01' });

  assert.equal(entries.length, 2);
  assert.match(entries[0], /category=connection_timeout/);
  assert.match(entries[1], /category=authentication_failed/);
});
