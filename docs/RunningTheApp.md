# Running CougarCalc

CougarCalc runs on Node.js 22. It supports a ready mode with PostgreSQL history and a deliberate degraded mode where calculations work but are not saved.

After a successful calculation, typing a number, decimal point, or `(` starts a new expression. Pressing an operator continues from the previous result.

This guide covers ordinary startup and deployment. Use [release-validation.md](user-helps/release-validation.md) for the complete smoke-test matrix, prerequisites, expected results, and the safety boundary around the disposable PostgreSQL recovery test.

## Install dependencies

From the repository root, verify Node 22 and install exactly the locked dependencies:

```powershell
node --version
npm ci
```

The version should begin with `v22.`. On Windows, use `npm.cmd` if the PowerShell execution policy blocks `npm.ps1`.

## Local ready mode

Install PostgreSQL, create the owner and application roles, apply migration `001` as `cougarcalc_owner`, and grant the lower-privilege app role only its runtime permissions. Complete commands are in [initial_db_setup.md](user-helps/initial_db_setup.md).

Copy the safe example to the ignored local file:

```powershell
Copy-Item .env.example .env
```

Use local non-TLS settings:

```text
HOST=127.0.0.1
PORT=3000
NODE_ENV=development
HISTORY_COOKIE_SECURE=false
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=cougarcalc
DATABASE_USER=cougarcalc_app
DATABASE_PASSWORD=replace_with_the_local_app_password
DATABASE_TLS_MODE=disable
```

Do not set `DATABASE_CA_PATH` in `disable` mode. Start and verify:

```powershell
npm start
```

Open <http://localhost:3000>. Expected checks are:

- `GET /health/live` returns `200` with `{"status":"live"}`.
- `GET /health/ready` returns `200` with `{"status":"ready"}`.
- A successful calculation returns `{"result":...}` and appears in this browser's history.
- Another browser profile starts with separate history.

Run the automated and real-database checks:

```powershell
npm test
node debug-check.js
```

## Local degraded mode

Use a shell that does not have a populated `.env`, or temporarily rename the ignored `.env` file outside the repository. Start with no database variables:

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:NODE_ENV = 'development'
$env:HISTORY_COOKIE_SECURE = 'false'
npm start
```

Expected behavior:

- liveness is `200`;
- readiness is `503` with only `{"status":"not ready"}`;
- calculations return `200`, the numeric result, `saved: false`, and the warning that the calculation was not saved;
- the page exposes the warning through an accessible live status region;
- history returns `503` with a safe public message; and
- missing setting names may appear in logs, but no configuration values appear.

The automated equivalent is:

```powershell
npm run smoke:degraded
```

## Elastic Beanstalk before RDS

Upload the inspected source bundle and initially configure only non-database application properties:

```text
NODE_ENV=production
HISTORY_COOKIE_SECURE=false
```

Beanstalk supplies `PORT`; CougarCalc defaults `HOST` to `0.0.0.0`. Use `/health/live` for initial environment health. The application should work in degraded mode before any RDS endpoint or password is added.

Do not upload `.env`. For a new classroom environment, create AWS resources only during the guided infrastructure walkthrough.

## Elastic Beanstalk with Aurora/RDS

After the RDS instance, owner migration, and security-group path are ready, add environment properties using safe deployment-specific values:

```text
DATABASE_HOST=the-rds-dns-endpoint
DATABASE_PORT=5432
DATABASE_NAME=cougarcalc
DATABASE_USER=cougarcalc_app
DATABASE_TLS_MODE=verify-full
DATABASE_CA_PATH=database/certs/global-bundle.pem
```

`verify-full` rejects raw IP addresses and uses the RDS DNS name for hostname verification. The pool verifies the server chain against Amazon's public CA bundle; CougarCalc does not use `rejectUnauthorized: false`.

Configure `DATABASE_PASSWORD` as a secret-backed Beanstalk environment variable. If the Secrets Manager secret contains a JSON credential object, select its top-level `password` field (for example, by using Elastic Beanstalk's supported `:password` JSON-key suffix). CougarCalc requires the resulting value to be one scalar password and safely rejects an injected JSON object before opening the pool. Never paste a password, secret ARN, or complete secret value into this file, a screenshot, or a troubleshooting log.

Elastic Beanstalk fetches the secret during instance bootstrapping; rotating the Secrets Manager value does not automatically update existing process environments. Use an approved `UpdateEnvironment` or `RestartAppServer` operation to refresh every instance, and plan rotations so old and new credentials can overlap while a scaled environment converges.

Adding or changing Beanstalk environment properties normally restarts the Node process. No source change or new ZIP is required. Verify `/health/ready` returns `200`, then save and reload browser history. Switch the Beanstalk health-check path from `/health/live` to `/health/ready` only after that validation.

The database connection and query ceilings are 35 and 10 seconds. Readiness itself has an independent 10-second overall ceiling, so a public health request does not wait for the full Aurora wake-up allowance. The shared connection attempt may finish in the background; a later readiness request can observe recovery without restarting Node.js.

## HTTPS and the cookie

For the first HTTP-only Beanstalk validation, keep:

```text
HISTORY_COOKIE_SECURE=false
```

After the custom hostname, Application Load Balancer HTTPS listener, ACM certificate, and HTTP-to-HTTPS redirect all work, change it to:

```text
HISTORY_COOKIE_SECURE=true
```

This setting protects browser cookie transport. It does not configure database TLS. Browser HTTPS ends at the load balancer; application-to-RDS TLS is configured separately with `DATABASE_TLS_MODE=verify-full`.

## Health and instance checks

PowerShell examples:

```powershell
Invoke-RestMethod http://localhost:3000/health/live

try {
  Invoke-RestMethod http://localhost:3000/health/ready
} catch {
  $_.Exception.Response.StatusCode
}

Invoke-RestMethod http://localhost:3000/diagnostics/instance
```

The `X-CougarCalc-Instance` response header and diagnostic JSON contain the same short marker. Two temporary Beanstalk targets should normally show different markers without revealing their raw hostnames.

## Build the deployment source ZIP

Use the deterministic builder for both manual and future CI/CD packaging:

```powershell
npm run bundle
npm run bundle:inspect
```

The output is `dist/cougarcalc-release-03.zip`. The inspection must list exactly the required application files at the archive root. It fails for Markdown, `.env`, `.git`, `node_modules`, tests, extra parent directories, private keys, credential-like paths, or missing runtime files. `dist/` is ignored; do not commit the generated ZIP.

The current allowlist contains exactly 12 entries, including `database-diagnostics.js`.

`.ebignore` is committed for EB CLI use, but it does not filter a ZIP assembled by some other tool. A future GitHub Actions workflow must call `npm run bundle` and upload that exact inspected ZIP. It must not zip the working directory independently.

## Safe failure expectations

Public responses never identify missing variables, database endpoints, credentials, SQL, stack traces, cookies, or token hashes. Safe server logs may contain:

- the names of missing database variables;
- fixed configuration and state-transition events;
- a readiness stage such as `connection`, `schema_index`, or `runtime_privileges`;
- a category such as `connection_timeout`, `authentication_failed`, or `insufficient_privilege`;
- a short stable code such as `ETIMEDOUT` or `28P01`;
- retryability, elapsed time, safe configuration characteristics, and the short instance marker; and
- a bounded operation such as `save_calculation` or `retrieve_history`.

Repeated identical failures are suppressed. A changed category, readiness recovery, or operation recovery is logged once. Never print `.env`, database hostnames or usernames, passwords, secret ARNs/values, connection strings, RDS CA contents, calculation expressions, request bodies, browser cookies/tokens/hashes, raw database errors, stacks, or the complete Beanstalk environment.

## Troubleshooting

### Readiness is `503`

Confirm all five database settings and `DATABASE_TLS_MODE` are present. Then use the first safe `readiness_failed` line to narrow the layer:

- `stage=connection` points to configuration, DNS, networking, TLS, authentication, database name, or Aurora wake-up;
- `stage=schema_columns`, `schema_constraint`, `schema_primary_key`, or `schema_index` points to migration/schema drift; and
- `stage=runtime_privileges` points to the app role's schema, table, or sequence grants.

The public response intentionally does not distinguish these cases. Use the safe category/code and direct owner-role verification without printing raw errors or configuration values.

### Password is reported as a structured value

`category=database_password_is_structured_value` means `DATABASE_PASSWORD` received a JSON object rather than one password. Configure the secret-backed Beanstalk variable to extract the top-level `password` field. Do not log or manually paste the complete secret to inspect it.

### Aurora is waking from auto-pause

A readiness request can return `503` at 10 seconds while the connection attempt continues for up to 35 seconds. Poll readiness at a reasonable interval. A successful resume logs one `readiness_recovered` event. Do not retry permanent authentication failures such as `code=28P01` without correcting the credentials.

### Local PostgreSQL unexpectedly starts degraded

Release 03 requires explicit `DATABASE_TLS_MODE=disable` for local development. Remove `DATABASE_CA_PATH` in this mode and confirm the port is an integer from 1 through 65535.

### RDS TLS is rejected

Use the RDS DNS endpoint, never an IP address. Confirm `DATABASE_TLS_MODE=verify-full` and `DATABASE_CA_PATH=database/certs/global-bundle.pem`. Compare the checked-in bundle against Amazon's current official RDS trust-store bundle and review any rotation notice before replacing it.

### The calculation succeeded but was not saved

This is intentional degraded behavior. The calculation is not queued for later recovery. Restore PostgreSQL readiness and perform a new calculation if it must be recorded.

### History is unexpectedly empty

History belongs to the anonymous `cougarcalc_history` cookie. A different browser, profile, private window, device, cleared cookie, or API request without the retained cookie has a different history.
