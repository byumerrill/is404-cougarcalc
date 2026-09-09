const { startServer } = require('./app');

async function runDebugCheck() {
  const { repository, server } = await startServer({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0'
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const readinessResponse = await fetch(`${baseUrl}/health/ready`);
    const readiness = await readinessResponse.json();
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
    const instanceResponse = await fetch(`${baseUrl}/diagnostics/instance`);
    const instance = await instanceResponse.json();

    console.log(
      JSON.stringify(
        {
          readiness: {
            status: readinessResponse.status,
            ready: readiness.status === 'ready'
          },
          calculation: {
            status: calculationResponse.status,
            saved: calculation.saved !== false
          },
          history: {
            status: historyResponse.status,
            entry_count: Array.isArray(history) ? history.length : 0
          },
          instance: instance.instance
        },
        null,
        2
      )
    );

    if (
      !readinessResponse.ok ||
      !calculationResponse.ok ||
      !historyResponse.ok ||
      !instanceResponse.ok
    ) {
      process.exitCode = 1;
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await repository.close();
  }
}

runDebugCheck().catch((error) => {
  console.error('Debug check failed. Review the safe database diagnostics above.');
  process.exitCode = 1;
});
