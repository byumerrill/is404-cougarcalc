const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONNECTION_TIMEOUT_MILLIS,
  QUERY_TIMEOUT_MILLIS,
  READINESS_TIMEOUT_MILLIS,
  createPoolFromEnv,
  createPostgresRepository,
  createUnavailableRepository,
  getMissingDatabaseVariables,
  readDatabaseConfig
} = require('../database');
const { createDatabaseDiagnostics } = require('../database-diagnostics');

const VALID_ENV = {
  DATABASE_HOST: 'db.example.test',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'cougarcalc',
  DATABASE_USER: 'cougarcalc_app',
  DATABASE_PASSWORD: 'do-not-print-this-secret',
  DATABASE_TLS_MODE: 'disable'
};
const REQUIRED_DATABASE_NAMES = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD'
];
const VALID_BROWSER_TOKEN_HASH = 'a'.repeat(64);

const VALID_SCHEMA_RESULTS = {
  'cougarcalc-verify-columns': [
    {
      column_name: 'calculation_id',
      data_type: 'bigint',
      is_nullable: 'NO',
      is_identity: 'YES',
      identity_generation: 'ALWAYS',
      column_default: null
    },
    {
      column_name: 'calculated_at',
      data_type: 'timestamp with time zone',
      is_nullable: 'NO',
      is_identity: 'NO',
      identity_generation: null,
      column_default: 'CURRENT_TIMESTAMP'
    },
    {
      column_name: 'expression',
      data_type: 'text',
      is_nullable: 'NO',
      is_identity: 'NO',
      identity_generation: null,
      column_default: null
    },
    {
      column_name: 'result',
      data_type: 'double precision',
      is_nullable: 'NO',
      is_identity: 'NO',
      identity_generation: null,
      column_default: null
    },
    {
      column_name: 'browser_token_hash',
      data_type: 'text',
      is_nullable: 'NO',
      is_identity: 'NO',
      identity_generation: null,
      column_default: null
    }
  ],
  'cougarcalc-verify-browser-hash-constraint': [
    {
      definition: "CHECK ((browser_token_hash ~ '^[0-9a-f]{64}$'::text))",
      is_validated: true
    }
  ],
  'cougarcalc-verify-primary-key': [
    { column_name: 'calculation_id' }
  ],
  'cougarcalc-verify-browser-history-index': [
    {
      column_name: 'browser_token_hash',
      is_descending: false,
      is_valid: true,
      is_ready: true,
      is_live: true
    },
    {
      column_name: 'calculated_at',
      is_descending: true,
      is_valid: true,
      is_ready: true,
      is_live: true
    },
    {
      column_name: 'calculation_id',
      is_descending: true,
      is_valid: true,
      is_ready: true,
      is_live: true
    }
  ],
  'cougarcalc-verify-runtime-privileges': [
    {
      has_schema_usage: true,
      has_table_select: true,
      has_table_insert: true,
      has_sequence_usage: true,
      has_table_update: true,
      has_table_delete: true
    }
  ]
};

function createSchemaPool(overrides = {}, calls = []) {
  return {
    async query(query) {
      calls.push(query);
      const rows = Object.hasOwn(overrides, query.name)
        ? overrides[query.name]
        : VALID_SCHEMA_RESULTS[query.name];
      return { rows };
    }
  };
}

test('database configuration reads the five required environment variables', () => {
  assert.deepEqual(readDatabaseConfig(VALID_ENV), {
    host: 'db.example.test',
    port: 5432,
    database: 'cougarcalc',
    user: 'cougarcalc_app',
    password: 'do-not-print-this-secret',
    ssl: false,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
    query_timeout: QUERY_TIMEOUT_MILLIS
  });
});

test('database configuration rejects each missing or blank required variable', () => {
  for (const name of REQUIRED_DATABASE_NAMES) {
    const missingEnv = { ...VALID_ENV };
    delete missingEnv[name];

    assert.throws(
      () => readDatabaseConfig(missingEnv),
      (error) => error.message.includes(name) && !error.message.includes(VALID_ENV.DATABASE_PASSWORD)
    );

    assert.throws(
      () => readDatabaseConfig({ ...VALID_ENV, [name]: '   ' }),
      (error) => error.message.includes(name) && !error.message.includes(VALID_ENV.DATABASE_PASSWORD)
    );
  }
});

test('database configuration reports all missing database variable names without values', () => {
  assert.deepEqual(getMissingDatabaseVariables({}), REQUIRED_DATABASE_NAMES);
  assert.deepEqual(
    getMissingDatabaseVariables({
      DATABASE_HOST: 'db.internal.test',
      DATABASE_PASSWORD: 'do-not-print-this-secret'
    }),
    ['DATABASE_PORT', 'DATABASE_NAME', 'DATABASE_USER']
  );
});

test('database configuration rejects invalid ports', () => {
  for (const port of ['not-a-port', '0', '65536', '5432.5']) {
    assert.throws(
      () => readDatabaseConfig({ ...VALID_ENV, DATABASE_PORT: port }),
      /DATABASE_PORT must be an integer between 1 and 65535/
    );
  }
});

test('database configuration rejects a JSON object password without exposing it', () => {
  const structuredSecret = JSON.stringify({
    username: 'cougarcalc_app',
    password: 'DO_NOT_LOG_INNER_SECRET_67890'
  });

  assert.throws(
    () =>
      readDatabaseConfig({
        ...VALID_ENV,
        DATABASE_PASSWORD: structuredSecret
      }),
    (error) =>
      error.code === 'COUGARCALC_DATABASE_PASSWORD_STRUCTURED' &&
      !error.message.includes(structuredSecret) &&
      !error.message.includes('DO_NOT_LOG_INNER_SECRET_67890')
  );

  assert.equal(
    readDatabaseConfig({
      ...VALID_ENV,
      DATABASE_PASSWORD: '{a-valid-scalar-password'
    }).password,
    '{a-valid-scalar-password'
  );
});

test('local database mode disables TLS and applies approved timeouts', () => {
  let poolConfig;
  const logEntries = [];
  const diagnostics = createDatabaseDiagnostics({
    logger: {
      log: (message) => logEntries.push(message),
      warn: (message) => logEntries.push(message),
      error: (message) => logEntries.push(message)
    }
  });
  class FakePool {
    constructor(config) {
      poolConfig = config;
    }

    on() {}
  }

  createPoolFromEnv(VALID_ENV, { PoolClass: FakePool, diagnostics });

  assert.equal(poolConfig.ssl, false);
  assert.equal(poolConfig.connectionTimeoutMillis, 35_000);
  assert.equal(poolConfig.query_timeout, 10_000);
  assert.equal(READINESS_TIMEOUT_MILLIS, 10_000);
  assert.deepEqual(logEntries, [
    '[database] configuration_valid tls=disable host_type=dns ca_configured=false port=5432'
  ]);
});

test('idle pool errors use the centralized safe diagnostic path', () => {
  const sentinel = 'DO_NOT_LOG_THIS_DATABASE_PASSWORD_12345';
  const logEntries = [];
  let idleErrorHandler;
  class FakePool {
    constructor() {}

    on(event, handler) {
      assert.equal(event, 'error');
      idleErrorHandler = handler;
    }
  }
  const diagnostics = createDatabaseDiagnostics({
    logger: {
      log: (message) => logEntries.push(message),
      warn: (message) => logEntries.push(message),
      error: (message) => logEntries.push(message)
    }
  });

  createPoolFromEnv(VALID_ENV, { PoolClass: FakePool, diagnostics });
  const error = new Error(`password=${sentinel}`);
  error.code = '08006';
  idleErrorHandler(error);

  assert.match(
    logEntries[1],
    /idle_connection_failed category=connection_failure code=08006 retryable=true/
  );
  assert.equal(JSON.stringify(logEntries).includes(sentinel), false);
});

test('verified TLS loads the CA and requires certificate verification', () => {
  const ca =
    '-----BEGIN CERTIFICATE-----\npublic-test-ca\n-----END CERTIFICATE-----\n';
  const requestedFiles = [];
  const config = readDatabaseConfig(
    {
      ...VALID_ENV,
      DATABASE_TLS_MODE: 'verify-full',
      DATABASE_CA_PATH: 'database/certs/global-bundle.pem'
    },
    {
      readFile(filePath, encoding) {
        requestedFiles.push({ filePath, encoding });
        return ca;
      }
    }
  );

  assert.deepEqual(requestedFiles, [
    { filePath: 'database/certs/global-bundle.pem', encoding: 'utf8' }
  ]);
  assert.deepEqual(config.ssl, { ca, rejectUnauthorized: true });
  assert.equal(JSON.stringify(config).includes('public-test-ca'), true);
});

test('invalid TLS configuration fails safely and never bypasses verification', () => {
  assert.throws(
    () => readDatabaseConfig({ ...VALID_ENV, DATABASE_TLS_MODE: 'prefer' }),
    /DATABASE_TLS_MODE must be either disable or verify-full/
  );
  assert.throws(
    () =>
      readDatabaseConfig({
        ...VALID_ENV,
        DATABASE_TLS_MODE: 'verify-full'
      }),
    /DATABASE_CA_PATH is required/
  );
  assert.throws(
    () =>
      readDatabaseConfig(
        {
          ...VALID_ENV,
          DATABASE_TLS_MODE: 'verify-full',
          DATABASE_CA_PATH: 'secret/internal/path.pem'
        },
        { readFile: () => { throw new Error('secret/internal/path.pem'); } }
      ),
    (error) =>
      error.message === 'DATABASE_CA_PATH could not be read.' &&
      !error.message.includes('secret/internal/path.pem')
  );
  assert.throws(
    () =>
      readDatabaseConfig(
        {
          ...VALID_ENV,
          DATABASE_TLS_MODE: 'verify-full',
          DATABASE_CA_PATH: 'not-a-certificate.pem'
        },
        { readFile: () => 'not a certificate' }
      ),
    /must contain PEM certificates/
  );
  assert.throws(
    () =>
      readDatabaseConfig(
        {
          ...VALID_ENV,
          DATABASE_HOST: '10.0.1.42',
          DATABASE_TLS_MODE: 'verify-full',
          DATABASE_CA_PATH: 'database/certs/global-bundle.pem'
        },
        {
          readFile: () =>
            '-----BEGIN CERTIFICATE-----\npublic-ca\n-----END CERTIFICATE-----\n'
        }
      ),
    /DATABASE_HOST must be a DNS hostname/
  );
  assert.throws(
    () =>
      readDatabaseConfig({
        ...VALID_ENV,
        DATABASE_CA_PATH: 'unexpected.pem'
      }),
    /must be omitted/
  );
});

test('the unavailable repository has the same safe readiness and history interface', async () => {
  const repository = createUnavailableRepository();

  assert.equal(await repository.checkReadiness(), false);
  await assert.rejects(() => repository.getHistory('a'.repeat(64)), /unavailable/);
  await assert.rejects(
    () => repository.saveCalculation({}),
    /unavailable/
  );
  await repository.close();
});

test('repository verifies database connectivity', async () => {
  const calls = [];
  const repository = createPostgresRepository({
    async query(query) {
      calls.push(query);
      return { rows: [] };
    }
  });

  await repository.verifyConnection();

  assert.deepEqual(calls, [
    {
      name: 'cougarcalc-verify-connection',
      text: 'SELECT 1'
    }
  ]);
});

test('repository readiness combines connection, schema, and permission checks safely', async () => {
  const readyRepository = createPostgresRepository(createSchemaPool());
  assert.equal(await readyRepository.checkReadiness(), true);

  const connectionFailure = createPostgresRepository({
    async query() {
      throw new Error('password=do-not-print-this-secret');
    }
  });
  assert.equal(await connectionFailure.checkReadiness(), false);

  const schemaFailure = createPostgresRepository(
    createSchemaPool({ 'cougarcalc-verify-columns': [] })
  );
  assert.equal(await schemaFailure.checkReadiness(), false);
});

test('repository diagnostics identify every readiness stage safely', async () => {
  const scenarios = [
    {
      stage: 'connection',
      pool: {
        async query() {
          const error = new Error('secret connection detail');
          error.code = '28P01';
          throw error;
        }
      },
      category: 'authentication_failed'
    },
    {
      stage: 'schema_columns',
      pool: createSchemaPool({ 'cougarcalc-verify-columns': [] }),
      category: 'schema_missing_or_invalid'
    },
    {
      stage: 'schema_constraint',
      pool: createSchemaPool({
        'cougarcalc-verify-browser-hash-constraint': []
      }),
      category: 'schema_missing_or_invalid'
    },
    {
      stage: 'schema_primary_key',
      pool: createSchemaPool({ 'cougarcalc-verify-primary-key': [] }),
      category: 'schema_missing_or_invalid'
    },
    {
      stage: 'schema_index',
      pool: createSchemaPool({
        'cougarcalc-verify-browser-history-index': []
      }),
      category: 'schema_missing_or_invalid'
    },
    {
      stage: 'runtime_privileges',
      pool: createSchemaPool({
        'cougarcalc-verify-runtime-privileges': [
          {
            ...VALID_SCHEMA_RESULTS['cougarcalc-verify-runtime-privileges'][0],
            has_table_insert: false
          }
        ]
      }),
      category: 'insufficient_privilege'
    }
  ];

  for (const scenario of scenarios) {
    const logEntries = [];
    const diagnostics = createDatabaseDiagnostics({
      logger: {
        log: (message) => logEntries.push(message),
        warn: (message) => logEntries.push(message),
        error: (message) => logEntries.push(message)
      }
    });
    const repository = createPostgresRepository(scenario.pool, { diagnostics });

    assert.equal(await repository.checkReadiness(), false);
    assert.equal(logEntries.length, 1);
    assert.match(logEntries[0], new RegExp(`stage=${scenario.stage}`));
    assert.match(logEntries[0], new RegExp(`category=${scenario.category}`));
    assert.equal(logEntries[0].includes('secret connection detail'), false);
  }
});

test('repository readiness has an overall timeout and deduplicates concurrent checks', async () => {
  let queryCount = 0;
  let releaseQuery;
  const pendingQuery = new Promise((resolve) => {
    releaseQuery = resolve;
  });
  const repository = createPostgresRepository(
    {
      async query() {
        queryCount += 1;
        return pendingQuery;
      }
    },
    { readinessTimeoutMillis: 20 }
  );

  const startedAt = Date.now();
  const results = await Promise.all([
    repository.checkReadiness(),
    repository.checkReadiness()
  ]);
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(results, [false, false]);
  assert.equal(queryCount, 1);
  assert.ok(elapsed < 250, `readiness took ${elapsed}ms`);
  releaseQuery({ rows: [] });
});

test('repository verifies the exact schema and required runtime privileges', async () => {
  const calls = [];
  const repository = createPostgresRepository(createSchemaPool({}, calls));

  assert.equal(await repository.verifySchema(), true);
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'cougarcalc-verify-columns',
      'cougarcalc-verify-browser-hash-constraint',
      'cougarcalc-verify-primary-key',
      'cougarcalc-verify-browser-history-index',
      'cougarcalc-verify-runtime-privileges'
    ]
  );
  assert.deepEqual(calls[0].values, ['public', 'calculation_history']);
  assert.match(calls[0].text, /table_schema = \$1/);
  assert.match(calls[0].text, /table_name = \$2/);
  assert.deepEqual(calls[1].values, [
    'public',
    'calculation_history',
    'calculation_history_browser_token_hash_check'
  ]);
  assert.match(calls[1].text, /pg_get_constraintdef/);
  assert.deepEqual(calls[3].values, [
    'public',
    'calculation_history',
    'calculation_history_browser_newest_idx'
  ]);
  assert.deepEqual(calls[4].values, [
    'public',
    'calculation_history',
    'calculation_history_calculation_id_seq'
  ]);
});

test('repository reports an incomplete or missing schema as not ready', async () => {
  const repository = createPostgresRepository(
    createSchemaPool({
      'cougarcalc-verify-columns': VALID_SCHEMA_RESULTS[
        'cougarcalc-verify-columns'
      ].slice(0, 2)
    })
  );

  assert.equal(await repository.verifySchema(), false);
});

test('repository rejects incorrect column types, identity, nullability, and defaults', async () => {
  const scenarios = [
    { column: 'result', property: 'data_type', value: 'numeric' },
    { column: 'calculation_id', property: 'is_identity', value: 'NO' },
    {
      column: 'calculation_id',
      property: 'identity_generation',
      value: 'BY DEFAULT'
    },
    { column: 'expression', property: 'is_nullable', value: 'YES' },
    { column: 'calculated_at', property: 'column_default', value: null },
    { column: 'browser_token_hash', property: 'data_type', value: 'uuid' },
    { column: 'browser_token_hash', property: 'is_nullable', value: 'YES' }
  ];

  for (const scenario of scenarios) {
    const columns = VALID_SCHEMA_RESULTS['cougarcalc-verify-columns'].map(
      (column) =>
        column.column_name === scenario.column
          ? { ...column, [scenario.property]: scenario.value }
          : { ...column }
    );
    const repository = createPostgresRepository(
      createSchemaPool({ 'cougarcalc-verify-columns': columns })
    );

    assert.equal(
      await repository.verifySchema(),
      false,
      `${scenario.column}.${scenario.property} should be rejected`
    );
  }
});

// The NOT NULL column blocks missing hashes, while this CHECK constraint blocks
// malformed non-null hashes inserted by anything other than the Node application.
test('repository requires the exact validated browser hash constraint', async () => {
  const scenarios = [
    {
      label: 'missing constraint',
      rows: []
    },
    {
      label: 'incorrect constraint definition',
      rows: [
        {
          definition: 'CHECK ((length(browser_token_hash) = 64))',
          is_validated: true
        }
      ]
    },
    {
      label: 'constraint created with NOT VALID',
      rows: [
        {
          definition: "CHECK ((browser_token_hash ~ '^[0-9a-f]{64}$'::text))",
          is_validated: false
        }
      ]
    }
  ];

  for (const scenario of scenarios) {
    const repository = createPostgresRepository(
      createSchemaPool({
        'cougarcalc-verify-browser-hash-constraint': scenario.rows
      })
    );

    assert.equal(
      await repository.verifySchema(),
      false,
      `${scenario.label} should fail database readiness`
    );
  }
});

test('repository rejects an incorrect primary key', async () => {
  const repository = createPostgresRepository(
    createSchemaPool({
      'cougarcalc-verify-primary-key': [{ column_name: 'expression' }]
    })
  );

  assert.equal(await repository.verifySchema(), false);
});

test('repository rejects an incorrect browser-scoped history index', async () => {
  const scenarios = [
    [],
    VALID_SCHEMA_RESULTS['cougarcalc-verify-browser-history-index'].slice(1),
    [
      {
        ...VALID_SCHEMA_RESULTS['cougarcalc-verify-browser-history-index'][0],
        is_descending: true
      },
      ...VALID_SCHEMA_RESULTS['cougarcalc-verify-browser-history-index'].slice(1)
    ],
    [
      VALID_SCHEMA_RESULTS['cougarcalc-verify-browser-history-index'][0],
      VALID_SCHEMA_RESULTS['cougarcalc-verify-browser-history-index'][2],
      VALID_SCHEMA_RESULTS['cougarcalc-verify-browser-history-index'][1]
    ],
    ...['is_valid', 'is_ready', 'is_live'].map((property) => [
      {
        ...VALID_SCHEMA_RESULTS['cougarcalc-verify-browser-history-index'][0],
        [property]: false
      },
      ...VALID_SCHEMA_RESULTS['cougarcalc-verify-browser-history-index'].slice(1)
    ])
  ];

  for (const indexRows of scenarios) {
    const repository = createPostgresRepository(
      createSchemaPool({
        'cougarcalc-verify-browser-history-index': indexRows
      })
    );
    assert.equal(await repository.verifySchema(), false);
  }
});

test('repository requires each runtime privilege but ignores extra privileges', async () => {
  const requiredPrivileges = [
    'has_schema_usage',
    'has_table_select',
    'has_table_insert',
    'has_sequence_usage'
  ];

  const repositoryWithExtras = createPostgresRepository(createSchemaPool());
  assert.equal(await repositoryWithExtras.verifySchema(), true);

  for (const privilege of requiredPrivileges) {
    const privileges = {
      ...VALID_SCHEMA_RESULTS['cougarcalc-verify-runtime-privileges'][0],
      [privilege]: false
    };
    const repository = createPostgresRepository(
      createSchemaPool({
        'cougarcalc-verify-runtime-privileges': [privileges]
      })
    );

    assert.equal(
      await repository.verifySchema(),
      false,
      `${privilege} should be required`
    );
  }
});

test('repository keeps injection-shaped calculation input out of prepared SQL text', async () => {
  const timestamp = new Date('2026-07-24T18:00:00Z');
  const expression = '1); DROP TABLE calculation_history; --';
  const calls = [];
  const repository = createPostgresRepository({
    async query(query) {
      calls.push(query);
      return {
        rows: [
          {
            calculation_id: '42',
            calculated_at: timestamp,
            expression,
            result: 2
          }
        ]
      };
    }
  });

  const saved = await repository.saveCalculation({
    browserTokenHash: VALID_BROWSER_TOKEN_HASH,
    expression,
    result: 2
  });

  assert.equal(calls[0].name, 'cougarcalc-save-calculation');
  assert.deepEqual(calls[0].values, [VALID_BROWSER_TOKEN_HASH, expression, 2]);
  assert.equal(calls[0].text.includes(VALID_BROWSER_TOKEN_HASH), false);
  assert.equal(calls[0].text.includes(expression), false);
  assert.match(calls[0].text, /VALUES \(\$1, \$2, \$3\)/);
  assert.deepEqual(saved, {
    id: 42,
    timestamp,
    expression,
    result: 2
  });
});

test('repository retrieves only scoped history newest first and maps database values', async () => {
  const timestamp = new Date('2026-07-24T18:00:00Z');
  let query;
  const repository = createPostgresRepository({
    async query(queryConfig) {
      query = queryConfig;
      return {
        rows: [
          {
            calculation_id: '2',
            calculated_at: timestamp,
            expression: '2 * 3',
            result: 6
          }
        ]
      };
    }
  });

  assert.deepEqual(await repository.getHistory(VALID_BROWSER_TOKEN_HASH), [
    {
      id: 2,
      timestamp,
      expression: '2 * 3',
      result: 6
    }
  ]);
  assert.equal(query.name, 'cougarcalc-get-history');
  assert.deepEqual(query.values, [VALID_BROWSER_TOKEN_HASH]);
  assert.equal(query.text.includes(VALID_BROWSER_TOKEN_HASH), false);
  assert.match(query.text, /WHERE browser_token_hash = \$1/);
  assert.match(
    query.text,
    /ORDER BY calculated_at DESC, calculation_id DESC/
  );
});

test('repository rejects missing or malformed browser token hashes', async () => {
  let queryCalled = false;
  const repository = createPostgresRepository({
    async query() {
      queryCalled = true;
      return { rows: [] };
    }
  });

  for (const browserTokenHash of [undefined, '', 'not-a-hash', 'A'.repeat(64)]) {
    await assert.rejects(
      () => repository.getHistory(browserTokenHash),
      /valid browser history token hash is required/
    );
    await assert.rejects(
      () =>
        repository.saveCalculation({
          browserTokenHash,
          expression: '1 + 1',
          result: 2
        }),
      /valid browser history token hash is required/
    );
  }

  assert.equal(queryCalled, false);
});

test('repository closes its connection pool', async () => {
  let closed = false;
  const repository = createPostgresRepository({
    async end() {
      closed = true;
    }
  });

  await repository.close();

  assert.equal(closed, true);
});
