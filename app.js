const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/calculate', (req, res) => {
  const { expression, a, b, operation } = req.body;

  if (typeof expression === 'string' && expression.trim() !== '') {
    const sanitized = expression.replace(/[^0-9.+\-*/() ]/g, '');
    if (sanitized.trim() === '') {
      return res.status(400).json({ error: 'Please enter a valid expression.' });
    }

    try {
      const result = Function(`"use strict"; return (${sanitized});`)();
      if (!Number.isFinite(result)) {
        return res.status(400).json({ error: 'Calculation produced an invalid result.' });
      }
      return res.json({ result });
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
  app.listen(PORT, () => {
    console.log(`CougarCalc listening on http://localhost:${PORT}`);
  });
}

module.exports = { app };
