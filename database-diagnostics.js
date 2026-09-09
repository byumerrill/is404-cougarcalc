const SAFE_ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/;

const ERROR_CLASSIFICATIONS = new Map([
  ['ENOTFOUND', ['dns_failure', true]],
  ['EAI_AGAIN', ['dns_failure', true]],
  ['ECONNREFUSED', ['connection_refused', true]],
  ['ETIMEDOUT', ['connection_timeout', true]],
  ['ESOCKETTIMEDOUT', ['connection_timeout', true]],
  ['ECONNRESET', ['connection_failure', true]],
  ['EHOSTUNREACH', ['connection_failure', true]],
  ['ENETUNREACH', ['connection_failure', true]],
  ['ERR_TLS_CERT_ALTNAME_INVALID', ['tls_verification_failed', false]],
  ['CERT_HAS_EXPIRED', ['tls_verification_failed', false]],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', ['tls_verification_failed', false]],
  ['SELF_SIGNED_CERT_IN_CHAIN', ['tls_verification_failed', false]],
  ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', ['tls_verification_failed', false]],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', ['tls_verification_failed', false]],
  ['28P01', ['authentication_failed', false]],
  ['3D000', ['database_not_found', false]],
  ['42501', ['insufficient_privilege', false]],
  ['3F000', ['schema_missing_or_invalid', false]],
  ['42P01', ['schema_missing_or_invalid', false]],
  ['42703', ['schema_missing_or_invalid', false]]
]);

const INTERNAL_CLASSIFICATIONS = new Map([
  [
    'COUGARCALC_DATABASE_PASSWORD_STRUCTURED',
    ['database_password_is_structured_value', false]
  ],
  ['COUGARCALC_CONFIGURATION_INVALID', ['configuration_invalid', false]],
  ['COUGARCALC_SCHEMA_INVALID', ['schema_missing_or_invalid', false]],
  ['COUGARCALC_PRIVILEGES_INVALID', ['insufficient_privilege', false]],
  ['COUGARCALC_READINESS_NOT_READY', ['unexpected_database_error', false]]
]);

function readSafeErrorCode(error) {
  if (!error || !SAFE_ERROR_CODE_PATTERN.test(String(error.code || ''))) {
    return undefined;
  }

  return String(error.code);
}

function classifyDatabaseError(error) {
  const internal =
    error && typeof error.code === 'string'
      ? INTERNAL_CLASSIFICATIONS.get(error.code)
      : undefined;
  if (internal) {
    return { category: internal[0], retryable: internal[1] };
  }

  const code = readSafeErrorCode(error);
  const exact = code && ERROR_CLASSIFICATIONS.get(code);
  if (exact) {
    return { category: exact[0], code, retryable: exact[1] };
  }

  if (code && code.startsWith('08')) {
    return { category: 'connection_failure', code, retryable: true };
  }

  if (code === '57P01' || code === '57P02' || code === '57P03') {
    return { category: 'connection_failure', code, retryable: true };
  }

  return {
    category: 'unexpected_database_error',
    ...(code ? { code } : {}),
    retryable: false
  };
}

function createSafeDatabaseError(code) {
  const error = new Error('Database operation failed.');
  error.code = code;
  return error;
}

function formatDatabaseDiagnostic(event, fields = {}) {
  const parts = [`[database] ${event}`];
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      parts.push(`${name}=${value}`);
    }
  }
  return parts.join(' ');
}

function createDatabaseDiagnostics({ logger = console, instanceMarker, now = Date.now } = {}) {
  let readinessFailureKey;
  let readinessFailureStartedAt;
  let degradedModeLogged = false;
  const operationFailures = new Map();
  let idleFailureKey;

  function emit(level, event, fields) {
    const method = typeof logger[level] === 'function' ? level : 'log';
    logger[method](
      formatDatabaseDiagnostic(event, {
        ...fields,
        ...(instanceMarker ? { instance: instanceMarker } : {})
      })
    );
  }

  function classifiedFields(error, extra = {}) {
    const classification = classifyDatabaseError(error);
    return {
      ...extra,
      category: classification.category,
      ...(classification.code ? { code: classification.code } : {}),
      retryable: classification.retryable
    };
  }

  return {
    configurationIncomplete(missingVariables) {
      emit('warn', 'configuration_invalid', {
        category: 'configuration_incomplete',
        missing: missingVariables.join(',')
      });
    },

    configurationInvalid(error) {
      const classification = classifyDatabaseError(error);
      emit('warn', 'configuration_invalid', {
        category:
          classification.category === 'unexpected_database_error'
            ? 'configuration_invalid'
            : classification.category
      });
    },

    configurationValid({ tlsMode, hostType, caConfigured, port }) {
      emit('log', 'configuration_valid', {
        tls: tlsMode,
        host_type: hostType,
        ca_configured: caConfigured,
        port
      });
    },

    readinessFailed(stage, error, { elapsedMs } = {}) {
      const fields = classifiedFields(error, {
        stage,
        ...(Number.isInteger(elapsedMs) ? { elapsed_ms: elapsedMs } : {})
      });
      const failureKey = `${stage}:${fields.category}:${fields.code || ''}`;
      if (failureKey === readinessFailureKey) {
        return;
      }

      readinessFailureKey = failureKey;
      readinessFailureStartedAt ??= now();
      emit('warn', 'readiness_failed', fields);
    },

    readinessNotReady() {
      if (!readinessFailureKey) {
        this.readinessFailed(
          'connection',
          createSafeDatabaseError('COUGARCALC_READINESS_NOT_READY')
        );
      }
    },

    readinessRecovered() {
      if (!readinessFailureKey) {
        return;
      }

      const elapsedMs = Math.max(0, now() - readinessFailureStartedAt);
      emit('log', 'readiness_recovered', { elapsed_ms: elapsedMs });
      readinessFailureKey = undefined;
      readinessFailureStartedAt = undefined;
    },

    operationFailed(operation, error) {
      const fields = classifiedFields(error, { operation });
      const failureKey = `${fields.category}:${fields.code || ''}`;
      if (operationFailures.get(operation) === failureKey) {
        return;
      }

      operationFailures.set(operation, failureKey);
      emit('error', 'operation_failed', fields);
    },

    operationRecovered(operation) {
      if (!operationFailures.delete(operation)) {
        return;
      }

      emit('log', 'operation_recovered', { operation });
    },

    idleConnectionFailed(error) {
      const fields = classifiedFields(error);
      const failureKey = `${fields.category}:${fields.code || ''}`;
      if (idleFailureKey === failureKey) {
        return;
      }

      idleFailureKey = failureKey;
      emit('error', 'idle_connection_failed', fields);
    },

    startingInDegradedMode() {
      if (!degradedModeLogged) {
        degradedModeLogged = true;
        emit('warn', 'starting_in_degraded_mode', {
          history_available: false
        });
      }
    }
  };
}

module.exports = {
  classifyDatabaseError,
  createDatabaseDiagnostics,
  createSafeDatabaseError,
  formatDatabaseDiagnostic
};
