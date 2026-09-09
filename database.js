const { Pool } = require('pg');
const fs = require('node:fs');
const net = require('node:net');
const {
  createDatabaseDiagnostics,
  createSafeDatabaseError
} = require('./database-diagnostics');

const REQUIRED_DATABASE_VARIABLES = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD'
];

// Aurora Serverless v2 can need more than 30 seconds to resume after a long
// pause. The public readiness request remains independently bounded below.
const CONNECTION_TIMEOUT_MILLIS = 35_000;
const QUERY_TIMEOUT_MILLIS = 10_000;
const READINESS_TIMEOUT_MILLIS = 10_000;
const DATABASE_TLS_MODES = new Set(['disable', 'verify-full']);

const EXPECTED_COLUMNS = new Map([
  [
    'calculation_id',
    {
      dataType: 'bigint',
      isNullable: 'NO',
      isIdentity: 'YES',
      identityGeneration: 'ALWAYS'
    }
  ],
  [
    'calculated_at',
    {
      dataType: 'timestamp with time zone',
      isNullable: 'NO',
      isIdentity: 'NO',
      requiresDefault: true
    }
  ],
  [
    'expression',
    {
      dataType: 'text',
      isNullable: 'NO',
      isIdentity: 'NO'
    }
  ],
  [
    'result',
    {
      dataType: 'double precision',
      isNullable: 'NO',
      isIdentity: 'NO'
    }
  ],
  [
    'browser_token_hash',
    {
      dataType: 'text',
      isNullable: 'NO',
      isIdentity: 'NO'
    }
  ]
]);

const BROWSER_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;
const BROWSER_TOKEN_HASH_CONSTRAINT_DEFINITION =
  "CHECK ((browser_token_hash ~ '^[0-9a-f]{64}$'::text))";

function hasExpectedColumns(rows) {
  if (rows.length !== EXPECTED_COLUMNS.size) {
    return false;
  }

  return rows.every((row) => {
    const expected = EXPECTED_COLUMNS.get(row.column_name);
    if (!expected) {
      return false;
    }

    return (
      row.data_type === expected.dataType &&
      row.is_nullable === expected.isNullable &&
      row.is_identity === expected.isIdentity &&
      (!expected.identityGeneration ||
        row.identity_generation === expected.identityGeneration) &&
      (!expected.requiresDefault ||
        (typeof row.column_default === 'string' &&
          row.column_default.trim() !== ''))
    );
  });
}

async function readIndexColumns(pool, { statementName, indexName }) {
  return pool.query({
    name: statementName,
    text: `SELECT attribute.attname AS column_name,
                  (index_catalog.indoption[index_key.position] & 1) = 1
                    AS is_descending,
                  index_catalog.indisvalid AS is_valid,
                  index_catalog.indisready AS is_ready,
                  index_catalog.indislive AS is_live
           FROM pg_catalog.pg_index AS index_catalog
           JOIN pg_catalog.pg_class AS table_class
             ON table_class.oid = index_catalog.indrelid
           JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = table_class.relnamespace
           JOIN pg_catalog.pg_class AS index_class
             ON index_class.oid = index_catalog.indexrelid
           JOIN pg_catalog.pg_am AS access_method
             ON access_method.oid = index_class.relam
           JOIN LATERAL generate_series(
             0, index_catalog.indnkeyatts - 1
           ) AS index_key(position) ON TRUE
           JOIN pg_catalog.pg_attribute AS attribute
             ON attribute.attrelid = table_class.oid
            AND attribute.attnum =
                index_catalog.indkey[index_key.position]
           WHERE namespace.nspname = $1
             AND table_class.relname = $2
             AND index_class.relname = $3
             AND access_method.amname = 'btree'
             AND index_catalog.indexprs IS NULL
             AND index_catalog.indpred IS NULL
           ORDER BY index_key.position`,
    values: ['public', 'calculation_history', indexName]
  });
}

function hasExpectedIndex(rows, expectedColumns) {
  return (
    rows.length === expectedColumns.length &&
    rows.every(
      (row, position) =>
        row.column_name === expectedColumns[position].name &&
        row.is_descending === expectedColumns[position].isDescending &&
        row.is_valid === true &&
        row.is_ready === true &&
        row.is_live === true
    )
  );
}

function requireBrowserTokenHash(value) {
  if (typeof value !== 'string' || !BROWSER_TOKEN_HASH_PATTERN.test(value)) {
    throw new Error('A valid browser history token hash is required.');
  }

  return value;
}

function getMissingDatabaseVariables(env = process.env) {
  return REQUIRED_DATABASE_VARIABLES.filter(
    (name) => typeof env[name] !== 'string' || env[name].trim() === ''
  );
}

function readDatabaseConfig(
  env = process.env,
  { readFile = fs.readFileSync } = {}
) {
  const missingVariables = getMissingDatabaseVariables(env);

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required environment variable${missingVariables.length === 1 ? '' : 's'}: ` +
        missingVariables.join(', ')
    );
  }

  const trimmedPassword = env.DATABASE_PASSWORD.trim();
  if (trimmedPassword.startsWith('{')) {
    try {
      const parsedPassword = JSON.parse(trimmedPassword);
      if (
        parsedPassword !== null &&
        typeof parsedPassword === 'object' &&
        !Array.isArray(parsedPassword)
      ) {
        // CougarCalc expects a scalar password. For a JSON Secrets Manager
        // secret, Elastic Beanstalk must extract its top-level password field.
        throw createSafeDatabaseError(
          'COUGARCALC_DATABASE_PASSWORD_STRUCTURED'
        );
      }
    } catch (error) {
      if (error.code === 'COUGARCALC_DATABASE_PASSWORD_STRUCTURED') {
        throw error;
      }
      // A password that merely begins with "{" remains a valid scalar value.
    }
  }

  const port = Number(env.DATABASE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DATABASE_PORT must be an integer between 1 and 65535.');
  }

  const tlsMode = env.DATABASE_TLS_MODE;
  if (!DATABASE_TLS_MODES.has(tlsMode)) {
    throw new Error(
      'DATABASE_TLS_MODE must be either disable or verify-full.'
    );
  }

  let ssl = false;
  if (tlsMode === 'verify-full') {
    if (net.isIP(env.DATABASE_HOST.trim()) !== 0) {
      throw new Error(
        'DATABASE_HOST must be a DNS hostname when DATABASE_TLS_MODE is verify-full.'
      );
    }
    if (
      typeof env.DATABASE_CA_PATH !== 'string' ||
      env.DATABASE_CA_PATH.trim() === ''
    ) {
      throw new Error(
        'DATABASE_CA_PATH is required when DATABASE_TLS_MODE is verify-full.'
      );
    }

    let ca;
    try {
      ca = readFile(env.DATABASE_CA_PATH.trim(), 'utf8');
    } catch (_error) {
      throw new Error('DATABASE_CA_PATH could not be read.');
    }

    if (
      typeof ca !== 'string' ||
      !ca.includes('-----BEGIN CERTIFICATE-----') ||
      !ca.includes('-----END CERTIFICATE-----')
    ) {
      throw new Error('DATABASE_CA_PATH must contain PEM certificates.');
    }

    ssl = {
      ca,
      rejectUnauthorized: true
    };
  } else if (
    typeof env.DATABASE_CA_PATH === 'string' &&
    env.DATABASE_CA_PATH.trim() !== ''
  ) {
    throw new Error(
      'DATABASE_CA_PATH must be omitted when DATABASE_TLS_MODE is disable.'
    );
  }

  return {
    host: env.DATABASE_HOST.trim(),
    port,
    database: env.DATABASE_NAME.trim(),
    user: env.DATABASE_USER.trim(),
    password: env.DATABASE_PASSWORD,
    ssl,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
    query_timeout: QUERY_TIMEOUT_MILLIS
  };
}

function createPoolFromEnv(
  env = process.env,
  {
    PoolClass = Pool,
    readFile = fs.readFileSync,
    diagnostics = createDatabaseDiagnostics()
  } = {}
) {
  const config = readDatabaseConfig(env, { readFile });
  diagnostics.configurationValid({
    tlsMode: env.DATABASE_TLS_MODE,
    hostType: net.isIP(config.host) === 0 ? 'dns' : 'ip',
    caConfigured: config.ssl !== false,
    port: config.port
  });
  const pool = new PoolClass(config);

  pool.on('error', (error) => {
    diagnostics.idleConnectionFailed(error);
  });

  return pool;
}

function createUnavailableRepository() {
  function unavailable() {
    throw new Error('Calculation history is unavailable.');
  }

  return {
    async checkReadiness() {
      return false;
    },

    async saveCalculation() {
      unavailable();
    },

    async getHistory() {
      unavailable();
    },

    async close() {}
  };
}

function toSafeIdentifier(value) {
  const identifier = Number(value);
  if (!Number.isSafeInteger(identifier)) {
    throw new Error('PostgreSQL returned an unsafe calculation identifier.');
  }

  return identifier;
}

function mapHistoryRow(row) {
  return {
    id: toSafeIdentifier(row.calculation_id),
    timestamp: row.calculated_at,
    expression: row.expression,
    result: Number(row.result)
  };
}

function createPostgresRepository(
  pool,
  {
    readinessTimeoutMillis = READINESS_TIMEOUT_MILLIS,
    diagnostics
  } = {}
) {
  if (
    !Number.isInteger(readinessTimeoutMillis) ||
    readinessTimeoutMillis < 1
  ) {
    throw new Error('readinessTimeoutMillis must be a positive integer.');
  }

  let readinessCheck;
  const repository = {
    async verifyConnection() {
      await pool.query({
        name: 'cougarcalc-verify-connection',
        text: 'SELECT 1'
      });
    },

    async verifySchema({ onStage = () => {}, onInvalid = () => {} } = {}) {
      onStage('schema_columns');
      const columnsResult = await pool.query({
        name: 'cougarcalc-verify-columns',
        text: `SELECT column_name,
                      data_type,
                      is_nullable,
                      is_identity,
                      identity_generation,
                      column_default
               FROM information_schema.columns
               WHERE table_schema = $1
                 AND table_name = $2`,
        values: ['public', 'calculation_history']
      });

      if (!hasExpectedColumns(columnsResult.rows)) {
        onInvalid(
          'schema_columns',
          createSafeDatabaseError('COUGARCALC_SCHEMA_INVALID')
        );
        return false;
      }

      onStage('schema_constraint');
      const browserHashConstraintResult = await pool.query({
        name: 'cougarcalc-verify-browser-hash-constraint',
        text: `SELECT pg_catalog.pg_get_constraintdef(
                        constraint_catalog.oid
                      ) AS definition,
                      constraint_catalog.convalidated AS is_validated
               FROM pg_catalog.pg_constraint AS constraint_catalog
               JOIN pg_catalog.pg_class AS table_class
                 ON table_class.oid = constraint_catalog.conrelid
               JOIN pg_catalog.pg_namespace AS namespace
                 ON namespace.oid = table_class.relnamespace
               WHERE namespace.nspname = $1
                 AND table_class.relname = $2
                 AND constraint_catalog.conname = $3
                 AND constraint_catalog.contype = 'c'`,
        values: [
          'public',
          'calculation_history',
          'calculation_history_browser_token_hash_check'
        ]
      });

      if (
        browserHashConstraintResult.rows.length !== 1 ||
        browserHashConstraintResult.rows[0].is_validated !== true ||
        browserHashConstraintResult.rows[0].definition !==
          BROWSER_TOKEN_HASH_CONSTRAINT_DEFINITION
      ) {
        onInvalid(
          'schema_constraint',
          createSafeDatabaseError('COUGARCALC_SCHEMA_INVALID')
        );
        return false;
      }

      onStage('schema_primary_key');
      const primaryKeyResult = await pool.query({
        name: 'cougarcalc-verify-primary-key',
        text: `SELECT attribute.attname AS column_name
               FROM pg_catalog.pg_index AS index_catalog
               JOIN pg_catalog.pg_class AS table_class
                 ON table_class.oid = index_catalog.indrelid
               JOIN pg_catalog.pg_namespace AS namespace
                 ON namespace.oid = table_class.relnamespace
               JOIN LATERAL generate_series(
                 0, index_catalog.indnkeyatts - 1
               ) AS index_key(position) ON TRUE
               JOIN pg_catalog.pg_attribute AS attribute
                 ON attribute.attrelid = table_class.oid
                AND attribute.attnum =
                    index_catalog.indkey[index_key.position]
               WHERE namespace.nspname = $1
                 AND table_class.relname = $2
                 AND index_catalog.indisprimary
                 AND index_catalog.indisvalid
               ORDER BY index_key.position`,
        values: ['public', 'calculation_history']
      });

      if (
        primaryKeyResult.rows.length !== 1 ||
        primaryKeyResult.rows[0].column_name !== 'calculation_id'
      ) {
        onInvalid(
          'schema_primary_key',
          createSafeDatabaseError('COUGARCALC_SCHEMA_INVALID')
        );
        return false;
      }

      onStage('schema_index');
      const browserIndexResult = await readIndexColumns(pool, {
        statementName: 'cougarcalc-verify-browser-history-index',
        indexName: 'calculation_history_browser_newest_idx'
      });

      if (
        !hasExpectedIndex(browserIndexResult.rows, [
          { name: 'browser_token_hash', isDescending: false },
          { name: 'calculated_at', isDescending: true },
          { name: 'calculation_id', isDescending: true }
        ])
      ) {
        onInvalid(
          'schema_index',
          createSafeDatabaseError('COUGARCALC_SCHEMA_INVALID')
        );
        return false;
      }

      onStage('runtime_privileges');
      const privilegesResult = await pool.query({
        name: 'cougarcalc-verify-runtime-privileges',
        text: `SELECT has_schema_privilege(
                        current_user, namespace.oid, 'USAGE'
                      ) AS has_schema_usage,
                      has_table_privilege(
                        current_user, table_class.oid, 'SELECT'
                      ) AS has_table_select,
                      has_table_privilege(
                        current_user, table_class.oid, 'INSERT'
                      ) AS has_table_insert,
                      has_sequence_privilege(
                        current_user, sequence_class.oid, 'USAGE'
                      ) AS has_sequence_usage
               FROM pg_catalog.pg_namespace AS namespace
               JOIN pg_catalog.pg_class AS table_class
                 ON table_class.relnamespace = namespace.oid
                AND table_class.relname = $2
                AND table_class.relkind IN ('r', 'p')
               JOIN pg_catalog.pg_class AS sequence_class
                 ON sequence_class.relnamespace = namespace.oid
                AND sequence_class.relname = $3
                AND sequence_class.relkind = 'S'
               WHERE namespace.nspname = $1`,
        values: [
          'public',
          'calculation_history',
          'calculation_history_calculation_id_seq'
        ]
      });
      const privileges = privilegesResult.rows[0];

      const hasRuntimePrivileges = Boolean(
        privileges &&
          privileges.has_schema_usage === true &&
          privileges.has_table_select === true &&
          privileges.has_table_insert === true &&
          privileges.has_sequence_usage === true
      );
      if (!hasRuntimePrivileges) {
        onInvalid(
          'runtime_privileges',
          createSafeDatabaseError('COUGARCALC_PRIVILEGES_INVALID')
        );
      }

      return hasRuntimePrivileges;
    },

    async saveCalculation({ browserTokenHash, expression, result }) {
      const scopedBrowserTokenHash = requireBrowserTokenHash(browserTokenHash);
      const queryResult = await pool.query({
        name: 'cougarcalc-save-calculation',
        text: `INSERT INTO public.calculation_history (
                 browser_token_hash, expression, result
               )
               VALUES ($1, $2, $3)
               RETURNING calculation_id, calculated_at, expression, result`,
        values: [scopedBrowserTokenHash, expression, result]
      });

      return mapHistoryRow(queryResult.rows[0]);
    },

    async getHistory(browserTokenHash) {
      const scopedBrowserTokenHash = requireBrowserTokenHash(browserTokenHash);
      const queryResult = await pool.query({
        name: 'cougarcalc-get-history',
        text: `SELECT calculation_id, calculated_at, expression, result
               FROM public.calculation_history
               WHERE browser_token_hash = $1
               ORDER BY calculated_at DESC, calculation_id DESC`,
        values: [scopedBrowserTokenHash]
      });

      return queryResult.rows.map(mapHistoryRow);
    },

    async close() {
      await pool.end();
    }
  };

  repository.checkReadiness = async function checkReadiness() {
    if (!readinessCheck) {
      const currentCheck = { stage: 'connection' };
      currentCheck.promise = (async () => {
        try {
          await repository.verifyConnection();
          let invalidReadiness;
          const schemaReady = await repository.verifySchema({
            onStage(stage) {
              currentCheck.stage = stage;
            },
            onInvalid(stage, error) {
              invalidReadiness = { stage, error };
            }
          });

          if (!schemaReady) {
            diagnostics?.readinessFailed(
              invalidReadiness?.stage || currentCheck.stage,
              invalidReadiness?.error ||
                createSafeDatabaseError('COUGARCALC_SCHEMA_INVALID')
            );
            return false;
          }

          diagnostics?.readinessRecovered();
          return true;
        } catch (error) {
          diagnostics?.readinessFailed(currentCheck.stage, error);
          return false;
        }
      })();
      readinessCheck = currentCheck;
      currentCheck.promise.finally(() => {
        if (readinessCheck === currentCheck) {
          readinessCheck = undefined;
        }
      });
    }

    const startedAt = Date.now();
    const readinessTimeout = Symbol('readiness timeout');
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(
        () => resolve(readinessTimeout),
        readinessTimeoutMillis
      );
    });

    const currentCheck = readinessCheck;
    const result = await Promise.race([currentCheck.promise, timeout]).finally(() => {
      clearTimeout(timer);
    });

    if (result === readinessTimeout) {
      diagnostics?.readinessFailed(
        currentCheck.stage,
        { code: 'ETIMEDOUT' },
        { elapsedMs: Date.now() - startedAt }
      );
      return false;
    }

    return result;
  };

  return repository;
}

module.exports = {
  CONNECTION_TIMEOUT_MILLIS,
  QUERY_TIMEOUT_MILLIS,
  READINESS_TIMEOUT_MILLIS,
  createPoolFromEnv,
  createPostgresRepository,
  createUnavailableRepository,
  getMissingDatabaseVariables,
  readDatabaseConfig
};
