# Running CougarCalc

CougarCalc runs directly as a Node.js application and connects to PostgreSQL running as a separate service. Calculation history is isolated by an anonymous browser cookie; it is not shared across browsers.

## Prerequisites

- A supported Node.js release with `process.loadEnvFile()` support
- PostgreSQL 17 initialized with migration `001`
- Git

No PostgreSQL extension, container runtime, reverse proxy, authentication system, or ORM is required.

For first-time PostgreSQL installation, role creation, permissions, and migrations, follow [initial_db_setup.md](user-helps/initial_db_setup.md).

## Install dependencies

From the repository root:

```powershell
npm ci
```

## Confirm PostgreSQL is running

On Ubuntu:

```bash
sudo systemctl enable --now postgresql
sudo systemctl status --no-pager postgresql
```

On Windows or macOS, use the service checks in the initial setup guide.

## Configure the application

Copy the committed example.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS or Ubuntu:

```bash
cp .env.example .env
```

Set all five required database variables:

```text
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=cougarcalc
DATABASE_USER=cougarcalc_app
DATABASE_PASSWORD=your_password
```

These application settings are optional:

```text
HOST=127.0.0.1
PORT=3000
NODE_ENV=development
HISTORY_COOKIE_SECURE=false
```

Keep `HISTORY_COOKIE_SECURE=false` while the browser reaches CougarCalc over HTTP. Set it to `true` only after deploying HTTPS; a `Secure` cookie is not returned by browsers over ordinary HTTP.

The database values have no defaults. Missing, blank, or invalid values prevent startup and identify the configuration variable that needs attention. Errors never print the password. `HISTORY_COOKIE_SECURE`, when present, must be exactly `true` or `false`.

`.env` is ignored by Git. Never commit it or paste real credentials or browser-cookie values into tracked documentation.

## Start the application

```powershell
npm start
```

Open <http://localhost:3000>. Before opening the HTTP listener, startup verifies the PostgreSQL connection, five exact table columns, validated browser-hash constraint, identity and primary-key configuration, browser-scoped history index, and required app-role permissions.

The first page request receives a `cougarcalc_history` cookie. The server hashes that token before database access. Chrome, Edge, private windows, and different devices use separate histories.

After a successful calculation, typing a number, decimal point, or `(` starts a new expression. Pressing an operator continues from the previous result.

For an Ubuntu HTTP deployment, provide the same environment variables to the existing Node.js systemd service and retain `HISTORY_COOKIE_SECURE=false`. Do not reuse the local database password.

## Test

Run the isolated automated suite:

```powershell
npm test
```

Run a real PostgreSQL smoke check after applying migration `001`:

```powershell
node debug-check.js
```

The smoke check keeps the issued cookie between its calculation and history requests. It starts the app on a temporary local port, saves `1.001-1`, retrieves that browser's history, prints the newest public record, and closes its HTTP server and pool. It never prints the cookie or token hash.

For manual verification:

1. Open CougarCalc in Chrome and save two calculations.
2. Open it in Edge and confirm history is initially empty.
3. Save a different calculation in Edge.
4. Confirm Chrome still shows only the two Chrome calculations.
5. Restart Node and confirm both browsers retain their separate histories.
6. Clear the CougarCalc cookie in one browser and confirm only that browser starts with empty history.

## API examples with one cookie jar

API clients must retain the cookie between calculation and history requests. In PowerShell:

```powershell
$body = @{ expression = "2 + 3 * 4" } | ConvertTo-Json
Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:3000/calculate" `
  -ContentType "application/json" `
  -Body $body `
  -SessionVariable cougarSession

Invoke-RestMethod `
  -Uri "http://localhost:3000/history" `
  -WebSession $cougarSession
```

A request without the prior cookie represents a new browser identity and correctly receives an empty history.

## Troubleshooting

### Missing required environment variable

Confirm the variable named in the startup error exists and is not blank. The required database names begin with `DATABASE_`, not `DB_`.

### Invalid `HISTORY_COOKIE_SECURE`

Use exactly `false` for HTTP or `true` for HTTPS. Values such as `yes`, `1`, or `TRUE` are rejected.

### Unable to connect to PostgreSQL

Check the PostgreSQL service, host, port, database name, app login, and app password. On Ubuntu:

```bash
sudo systemctl status --no-pager postgresql
```

### PostgreSQL is connected but not ready

For a clean Release 2 database, run the schema initialization as `cougarcalc_owner`:

```sql
\set ON_ERROR_STOP on
SET ROLE cougarcalc_owner;
\i database/migrations/001-create-calculation-history.sql
```

If startup still reports that PostgreSQL is not ready, verify the schema, table, and identity-sequence grants in [initial_db_setup.md](user-helps/initial_db_setup.md).

### History is unexpectedly empty

Confirm the browser still has the `cougarcalc_history` cookie and that the same browser profile is being used. A different browser, private window, cleared cookie, or API request without a cookie intentionally receives a separate empty history.

If every request receives a new cookie, confirm `HISTORY_COOKIE_SECURE` is `false` for HTTP. Browsers do not return cookies marked `Secure` over HTTP.

### Calculation or history returns `503`

Check PostgreSQL availability and application logs. The public error intentionally omits credentials, browser tokens, token hashes, and database details.
