const { startServer } = require('./app');

async function runDebugCheck() {
  const { repository, server } = await startServer({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0'
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const calculationResponse = await fetch(`${baseUrl}/calculate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expression: '1.001-1' })
    });
    const calculation = await calculationResponse.json();
    const setCookieHeader = calculationResponse.headers.get('set-cookie');
    const historyCookie = setCookieHeader?.split(';', 1)[0];
    if (!historyCookie) {
      throw new Error('The application did not issue a browser history cookie.');
    }

    const historyResponse = await fetch(`${baseUrl}/history`, {
      headers: { cookie: historyCookie }
    });
    const history = await historyResponse.json();

    console.log(
      JSON.stringify(
        {
          calculation: {
            status: calculationResponse.status,
            body: calculation
          },
          history: {
            status: historyResponse.status,
            newest: Array.isArray(history) ? history[0] : history
          }
        },
        null,
        2
      )
    );

    if (!calculationResponse.ok || !historyResponse.ok) {
      process.exitCode = 1;
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await repository.close();
  }
}

runDebugCheck().catch((error) => {
  console.error(`Debug check failed: ${error.message}`);
  process.exitCode = 1;
});
