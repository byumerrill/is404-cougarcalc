const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/calculate', (req, res) => {
  const { a, b, operation } = req.body;
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
