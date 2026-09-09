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
const { createPoolFromEnv, createPostgresRepository } = require('./database');

const EXPRESSION_PATTERN = /^[0-9.+\-*/()\s]+$/;

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
  onDatabaseError = () => {}
}) {
  if (!repository) {
    throw new Error('A database repository is required.');
  }
  if (typeof historyCookieSecure !== 'boolean') {
    throw new Error('historyCookieSecure must be a boolean.');
  }

  const app = express();

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

  app.get('/history', async (req, res) => {
    try {
      return res.json(await repository.getHistory(req.historyTokenHash));
    } catch (_error) {
      onDatabaseError('retrieve history');
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
    } catch (_error) {
      onDatabaseError('save calculation');
      return res.status(503).json({
        error: 'The calculation could not be saved.'
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
    createRepository = createPostgresRepository
  } = {}
) {
  const historyCookieSecure = readHistoryCookieSecure(env);
  const pool = createPool(env);
  const repository = createRepository(pool);

  try {
    await repository.verifyConnection();
  } catch (_error) {
    await repository.close().catch(() => {});
    throw new Error('Unable to connect to PostgreSQL using the configured settings.');
  }

  try {
    if (!(await repository.verifySchema())) {
      throw new Error('Required database structure or permissions are missing.');
    }
  } catch (_error) {
    await repository.close().catch(() => {});
    throw new Error(
      'PostgreSQL is connected but not ready. Verify ' +
        'database/migrations/001-create-calculation-history.sql and ' +
        'the application role permissions.'
    );
  }

  const app = createApp({
    repository,
    nodeEnv: env.NODE_ENV || 'development',
    historyCookieSecure,
    onDatabaseError(context) {
      console.error(`Database operation failed: ${context}.`);
    }
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
  console.log(`CougarCalc listening on http://${browserHost}:${listeningPort}`);
  if (host === '0.0.0.0') {
    console.log(`From another device, use http://<this-computer-ip>:${port}`);
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
  calculateExpression,
  createApp,
  startServer
};
