if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

const express = require('express');
const path = require('path');
const {
  createHistoryIdentity,
  readHistoryCookieSecure
} = require('./browser-identity');
const {
  createPoolFromEnv,
  createPostgresRepository,
  createUnavailableRepository,
  getMissingDatabaseVariables
} = require('./database');
const { createDatabaseDiagnostics } = require('./database-diagnostics');
const { createInstanceMarker } = require('./instance-marker');

const EXPRESSION_PATTERN = /^[0-9.+\-*/()\s]+$/;
const UNSAVED_WARNING =
  'History is temporarily unavailable; this calculation was not saved.';

function calculateExpression(expression) {
  const sanitized = expression.replace(/\s+/g, '');

  if (sanitized === '' || !EXPRESSION_PATTERN.test(sanitized)) {
    return { error: 'Please enter a valid expression.' };
  }

  try {
    const result = Function(`"use strict"; return (${sanitized});`)();
    if (!Number.isFinite(result)) {
      return { error: 'Calculation produced an invalid result.' };
    }

    const normalizedResult = Number(result.toFixed(10));
    return { result: normalizedResult === 0 ? 0 : normalizedResult };
  } catch (_error) {
    return { error: 'Please enter a valid expression.' };
  }
}

function createApp({
  repository,
  nodeEnv = process.env.NODE_ENV || 'development',
  historyCookieSecure = false,
  hostnameSource,
  instanceMarker,
  databaseDiagnostics,
  onDatabaseError = () => {}
}) {
  if (!repository) {
    throw new Error('A database repository is required.');
  }
  if (typeof historyCookieSecure !== 'boolean') {
    throw new Error('historyCookieSecure must be a boolean.');
  }

  const app = express();
  const servingInstanceMarker =
    instanceMarker || createInstanceMarker(hostnameSource);

  function reportDatabaseFailure(operation, error) {
    databaseDiagnostics?.operationFailed(operation, error);
    onDatabaseError(operation, error);
  }

  function reportDatabaseRecovery(operation) {
    databaseDiagnostics?.operationRecovered(operation);
  }

  app.use((_req, res, next) => {
    res.setHeader('X-CougarCalc-Instance', servingInstanceMarker);
    next();
  });

  app.use((req, res, next) => {
    const needsHistoryIdentity =
      (req.method === 'GET' && (req.path === '/' || req.path === '/history')) ||
      (req.method === 'POST' && req.path === '/calculate');

    if (needsHistoryIdentity) {
      const identity = createHistoryIdentity(req.headers.cookie, {
        secure: historyCookieSecure
      });
      req.historyTokenHash = identity.tokenHash;
      if (identity.setCookieHeader) {
        res.setHeader('Set-Cookie', identity.setCookieHeader);
      }
    }

    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.json());

  app.get('/cougar-icon-v2.png', (_req, res) => {
    res.sendFile(path.join(__dirname, 'cougar-icon-v2.png'));
  });

  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.get('/environment', (_req, res) => {
    res.json({ environment: nodeEnv });
  });

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'live' });
  });

  app.get('/health/ready', async (_req, res) => {
    let ready = false;
    try {
      ready = (await repository.checkReadiness()) === true;
      if (ready) {
        databaseDiagnostics?.readinessRecovered();
      } else {
        databaseDiagnostics?.readinessNotReady();
      }
    } catch (error) {
      databaseDiagnostics?.readinessFailed('connection', error);
      onDatabaseError('readiness_check', error);
    }

    return res
      .status(ready ? 200 : 503)
      .json({ status: ready ? 'ready' : 'not ready' });
  });

  app.get('/diagnostics/instance', (_req, res) => {
    res.json({ instance: servingInstanceMarker });
  });

  app.get('/history', async (req, res) => {
    try {
      const history = await repository.getHistory(req.historyTokenHash);
      reportDatabaseRecovery('retrieve_history');
      return res.json(history);
    } catch (error) {
      reportDatabaseFailure('retrieve_history', error);
      return res.status(503).json({
        error: 'Calculation history is temporarily unavailable.'
      });
    }
  });

  app.post('/calculate', async (req, res) => {
    const { expression, a, b, operation } = req.body || {};
    let result;
    let storedExpression;

    if (typeof expression === 'string') {
      const calculation = calculateExpression(expression);
      if (calculation.error) {
        return res.status(400).json({ error: calculation.error });
      }

      result = calculation.result;
      storedExpression = expression;
    } else {
      const numA = Number(a);
      const numB = Number(b);

      if (!Number.isFinite(numA) || !Number.isFinite(numB)) {
        return res.status(400).json({ error: 'Please enter valid numbers.' });
      }

      switch (operation) {
        case '+':
          result = numA + numB;
          break;
        case '-':
          result = numA - numB;
          break;
        case '*':
          result = numA * numB;
          break;
        case '/':
          if (numB === 0) {
            return res.status(400).json({ error: 'Cannot divide by zero.' });
          }
          result = numA / numB;
          break;
        default:
          return res.status(400).json({ error: 'Unsupported operation.' });
      }

      if (!Number.isFinite(result)) {
        return res.status(400).json({
          error: 'Calculation produced an invalid result.'
        });
      }

      storedExpression = `${numA} ${operation} ${numB}`;
    }

    try {
      await repository.saveCalculation({
        browserTokenHash: req.historyTokenHash,
        expression: storedExpression,
        result
      });
      reportDatabaseRecovery('save_calculation');
    } catch (error) {
      reportDatabaseFailure('save_calculation', error);
      return res.json({
        result,
        saved: false,
        warning: UNSAVED_WARNING
      });
    }

    return res.json({ result });
  });

  app.use((error, _req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({ error: 'Please provide valid JSON.' });
    }

    return next(error);
  });

  return app;
}

async function startServer(
  env = process.env,
  {
    createPool = createPoolFromEnv,
    createRepository = createPostgresRepository,
    createUnavailable = createUnavailableRepository,
    hostnameSource,
    logger = console
  } = {}
) {
  const historyCookieSecure = readHistoryCookieSecure(env);
  const instanceMarker = createInstanceMarker(hostnameSource);
  const databaseDiagnostics = createDatabaseDiagnostics({
    logger,
    instanceMarker
  });
  const missingVariables = getMissingDatabaseVariables(env);
  let repository;
  let hasConfiguredRepository = false;

  if (missingVariables.length > 0) {
    databaseDiagnostics.configurationIncomplete(missingVariables);
    repository = createUnavailable();
    databaseDiagnostics.startingInDegradedMode();
  } else {
    try {
      const pool = createPool(env, { diagnostics: databaseDiagnostics });
      repository = createRepository(pool, { diagnostics: databaseDiagnostics });
      hasConfiguredRepository = true;
    } catch (error) {
      databaseDiagnostics.configurationInvalid(error);
      repository = createUnavailable();
      databaseDiagnostics.startingInDegradedMode();
    }
  }

  if (hasConfiguredRepository) {
    let initiallyReady = false;
    try {
      initiallyReady = (await repository.checkReadiness()) === true;
      if (initiallyReady) {
        databaseDiagnostics.readinessRecovered();
      } else {
        databaseDiagnostics.readinessNotReady();
      }
    } catch (error) {
      databaseDiagnostics.readinessFailed('connection', error);
      initiallyReady = false;
    }

    if (!initiallyReady) {
      databaseDiagnostics.startingInDegradedMode();
    }
  }

  const app = createApp({
    repository,
    nodeEnv: env.NODE_ENV || 'development',
    historyCookieSecure,
    instanceMarker,
    databaseDiagnostics
  });
  const port = env.PORT || 3000;
  const host = env.HOST || '0.0.0.0';

  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const listeningServer = app.listen(port, host, () => resolve(listeningServer));
      listeningServer.once('error', reject);
    });
  } catch (error) {
    await repository.close().catch(() => {});
    throw error;
  }

  const browserHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  const listeningPort = server.address().port;
  logger.log(`Node.js runtime: ${process.version}`);
  logger.log(`CougarCalc listening on http://${browserHost}:${listeningPort}`);
  if (host === '0.0.0.0') {
    logger.log(`From another device, use http://<this-computer-ip>:${port}`);
  }

  return { app, repository, server };
}

if (require.main === module) {
  startServer()
    .then(({ repository, server }) => {
      async function shutDown() {
        server.close(async () => {
          await repository.close();
          process.exit(0);
        });
      }

      process.once('SIGINT', shutDown);
      process.once('SIGTERM', shutDown);
    })
    .catch((error) => {
      console.error(`CougarCalc failed to start: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  UNSAVED_WARNING,
  calculateExpression,
  createApp,
  startServer
};
