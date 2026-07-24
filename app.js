require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

function getEnvironmentLabel(nodeEnvironment) {
  return nodeEnvironment === 'production' ? 'Production' : 'Development';
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.use(express.json());
app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'Please provide valid JSON.' });
  }

  return next(error);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/calculate', (req, res) => {
  const { expression, a, b, operation } = req.body || {};

  if (typeof expression === 'string') {
    const sanitized = expression.replace(/\s+/g, '');
    if (sanitized === '' || /[^0-9.+\-*/()]/.test(sanitized)) {
      return res.status(400).json({ error: 'Please enter a valid expression.' });
    }

    try {
      const result = Function(`"use strict"; return (${sanitized});`)();
      if (!Number.isFinite(result)) {
        return res.status(400).json({ error: 'Calculation produced an invalid result.' });
      }

      const normalizedResult = Number(result.toFixed(10));

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
  app.listen(PORT, HOST, () => {
    console.log(`CougarCalc listening on all IPv4 network interfaces (${HOST}) on port ${PORT}`);
    console.log(`On this computer, use http://localhost:${PORT}`);
    console.log(`From another device, use http://<this-computer-ip>:${PORT}`);
  });
}

app.get('/environment', (_req, res) => {
  res.json({ environment: getEnvironmentLabel(NODE_ENV) });
});

module.exports = { app, getEnvironmentLabel };
