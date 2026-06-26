const { app } = require('./app');

const server = app.listen(0, async () => {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/calculate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expression: '1.001-1' })
  });
  const data = await response.json();
  console.log(JSON.stringify({ status: response.status, body: data }, null, 2));
  server.close();
});
