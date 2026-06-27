const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const logFilePath = path.join(__dirname, 'logs', 'user-requests.csv');
const environmentLabel = process.env.NODE_ENV === 'production' ? 'Production' : 'Development';

function normalizeAddress(address) {
  if (!address) {
    return 'unknown';
  }

  const normalizedAddress = address.trim();

  if (
    normalizedAddress === '::1' ||
    normalizedAddress === '0:0:0:0:0:0:0:1' ||
    normalizedAddress === '::ffff:127.0.0.1' ||
    normalizedAddress === '::ffff:0:1'
  ) {
    return '127.0.0.1';
  }

  if (normalizedAddress.startsWith('::ffff:')) {
    return normalizedAddress.slice(7);
  }

  return normalizedAddress;
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.use(express.json());

app.use((req, res, next) => {
  const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const localAddress = normalizeAddress(req.socket.localAddress);
  const localPort = req.socket.localPort || '';
  const remoteAddress = normalizeAddress(req.socket.remoteAddress);
  const remotePort = req.socket.remotePort || '';
  req.requestLog = { timestamp, localAddress, localPort, remoteAddress, remotePort };
  next();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/calculate', (req, res) => {
  const { expression, a, b, operation, nickname } = req.body;

  if (typeof expression === 'string' && expression.trim() !== '') {
    const sanitized = expression.replace(/\s+/g, '').replace(/[^0-9.+\-*/()]/g, '');
    if (sanitized.trim() === '') {
      return res.status(400).json({ error: 'Please enter a valid expression.' });
    }

    try {
      const result = Function(`"use strict"; return (${sanitized});`)();
      if (!Number.isFinite(result)) {
        return res.status(400).json({ error: 'Calculation produced an invalid result.' });
      }

      const normalizedResult = Number(result.toFixed(10));
      const logLine = [
        req.requestLog.timestamp,
        JSON.stringify(req.requestLog.localAddress),
        req.requestLog.localPort,
        JSON.stringify(req.requestLog.remoteAddress),
        req.requestLog.remotePort,
        JSON.stringify((nickname || 'Anonymous').toString()),
        JSON.stringify(expression)
      ].join(',');
      fs.appendFileSync(logFilePath, `${logLine}\n`);

      return res.json({ result: normalizedResult === 0 ? 0 : normalizedResult });
    } catch (error) {
      return res.status(400).json({ error: 'Please enter a valid expression.' });
    }
  }

  const numA = Number(a);
  const numB = Number(b);

  if (!Number.isFinite(numA) || !Number.isFinite(numB)) {
    return res.status(400).json({ error: 'Please enter valid numbers.' });
  }

  let result;
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

  res.json({ result });
});

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`CougarCalc listening on http://localhost:${PORT}`);
  });
}

app.get('/environment', (_req, res) => {
  res.json({ environment: environmentLabel });
});

module.exports = { app, environmentLabel, normalizeAddress };
