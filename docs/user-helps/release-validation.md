# CougarCalc Release 03 validation guide

This is the canonical guide for validating a CougarCalc Release 03 candidate. Run commands from the repository root with Node.js 22. The checks have different purposes; passing one does not replace the others.

## Validation matrix

| Check | Purpose | Prerequisites | Changes state? | Expected result |
| --- | --- | --- | --- | --- |
| `npm test` | Isolated application, security, database-adapter, and bundle tests | `npm ci` | Creates and removes temporary test files | 80 tests pass |
| `npm run smoke:degraded` | Proves the calculator works without database configuration | Installed dependencies | Opens a temporary local HTTP listener only | Liveness `200`, readiness `503`, result `14`, `saved: false` |
| `node debug-check.js` | Proves one ready application-to-PostgreSQL path | A migrated database and valid app configuration | Inserts one calculation-history row | Readiness and HTTP checks succeed; output contains only a safe summary |
| `node scripts/postgres-recovery-smoke.js` | Proves outage and recovery without restarting Node | An explicitly disposable PostgreSQL cluster prepared for this script | Stops, starts, and writes to that cluster | Ready, degraded, and recovered assertions pass |
| `npm run bundle` and `npm run bundle:inspect` | Builds and validates the Beanstalk source artifact | Repository runtime files | Replaces ignored `dist/cougarcalc-release-03.zip` | Exactly 12 allowlisted runtime entries pass inspection |
| Manual browser and AWS checks | Proves the actual load balancer, Beanstalk, Aurora/RDS, cookie, TLS, and log behavior | Deployed candidate and migrated AWS database | Writes test calculations and may wake Aurora | Public behavior and safe server logs match this guide |

## 1. Clean install and automated suite

Verify the runtime, install the exact locked dependency tree, and run the suite:

```powershell
node --version
npm ci
npm test
```

The Node version must begin with `v22.`. The current candidate has 80 automated tests. They require no AWS account or live database and include assertions that passwords, calculation expressions, cookies, browser tokens/hashes, and raw database errors never appear in captured diagnostic logs.

## 2. Degraded-mode smoke test

Run:

```powershell
npm run smoke:degraded
```

The script passes an explicit no-database environment to a temporary server. It does not use or modify PostgreSQL. Expected summary:

```json
{"node":"v22.x.x","liveness":200,"readiness":503,"calculation":{"result":14,"saved":false}}
```

Safe diagnostic lines may precede the summary. They should show incomplete configuration, degraded startup, generic not-ready state, and the failed save operation without containing environment values or user data.

## 3. Ready-database smoke test

First complete [initial_db_setup.md](initial_db_setup.md): apply migration `001` as `cougarcalc_owner`, grant the restricted `cougarcalc_app` permissions, and configure the local `.env` file. Then run:

```powershell
node debug-check.js
```

This check starts CougarCalc on a temporary port, confirms readiness, performs one calculation, retains its anonymous cookie internally, retrieves history, reads the instance marker, and closes the HTTP server and pool. It writes one test calculation to the configured database.

Its JSON output contains only:

- readiness status and a boolean ready value;
- calculation HTTP status and whether the row was saved;
- history HTTP status and entry count; and
- the short instance marker.

It does not print the expression, result, cookie, browser token/hash, database password, connection string, environment, or caught error message.

## 4. Disposable PostgreSQL outage and recovery smoke test

> **Safety warning:** This script stops and starts the PostgreSQL cluster identified by its environment variables. Never point it at Aurora/RDS, production, a shared server, or a normal development cluster. Use only a disposable local cluster created specifically for this test.

The script does not provision its database. Before running it, prepare a disposable PostgreSQL cluster with:

- database `cougarcalc_release3`;
- login `cougarcalc_app_release3` with the disposable password already named in the script;
- migration `001` applied by an owner role;
- the same restricted schema, table, and sequence permissions as the normal app role; and
- a dedicated unused port, normally `65432`.

Inspect the script and set the control paths explicitly:

```powershell
$env:RELEASE_TEST_PG_CTL = 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe'
$env:RELEASE_TEST_PG_DATA = 'C:\path\to\disposable\release-test-data'
$env:RELEASE_TEST_PG_LOG = 'C:\path\to\disposable\release-test.log'
$env:RELEASE_TEST_PG_PORT = '65432'

node scripts/postgres-recovery-smoke.js
```

The script verifies:

1. liveness, readiness, save, and history while PostgreSQL is ready;
2. readiness `503` and an explicitly unsaved calculation while PostgreSQL is stopped;
3. readiness and new saves recover after PostgreSQL restarts without restarting Node; and
4. the outage calculation is not silently inserted later.

Afterward, stop and remove the disposable cluster according to the local PostgreSQL procedure. Do not reuse it for development data.

## 5. Build and inspect the deployment bundle

Run both commands:

```powershell
npm run bundle
npm run bundle:inspect
```

The artifact is `dist/cougarcalc-release-03.zip`. Inspection must report exactly 12 allowlisted runtime entries at the archive root, including `database-diagnostics.js`. It fails closed for Markdown, `.env`, Git metadata, dependencies, tests, private keys, credential-like paths, unsafe parent paths, missing files, and unexpected files.

The ZIP is ignored by Git. Rebuild it after any runtime-file change; documentation-only changes do not alter it because all Markdown is excluded.

## 6. Manual browser validation

Against a ready local or AWS environment:

1. Confirm `/health/live` and `/health/ready` return `200`.
2. Save two calculations in one browser and confirm newest-first history.
3. Open a different browser/profile and confirm its history is separate.
4. Restart Node or deploy a replacement instance and confirm saved history remains.
5. Confirm `X-CougarCalc-Instance` matches `/diagnostics/instance` and contains only a 12-character marker.
6. If using HTTPS, confirm the history cookie includes `Secure`; keep `HISTORY_COOKIE_SECURE=false` during HTTP-only validation.

## 7. AWS diagnostics and Aurora wake-up validation

Use the inspected ZIP and a non-production Beanstalk environment. The public `/health/ready` response must remain only `ready` or `not ready`; use instance logs or CloudWatch for the safe internal reason.

Expected successful startup context resembles:

```text
[database] configuration_valid tls=verify-full host_type=dns ca_configured=true port=5432 instance=<marker>
```

Failure logs should contain a fixed stage, category, optional bounded code, retryability, and instance marker. They must not contain hostnames, usernames, passwords, secret ARNs/values, expressions, cookies, browser tokens/hashes, request bodies, or raw errors.

When Aurora Serverless v2 is paused, the first readiness request may return `503` after its 10-second public ceiling while the shared connection attempt continues for up to 35 seconds. Poll readiness at a reasonable interval. A successful wake-up should produce one `readiness_recovered` transition rather than a success line for every poll. Authentication failures such as `28P01` are non-retryable and should be fixed rather than repeatedly retried. AWS describes the behavior and application considerations in [Scaling to Zero ACUs with automatic pause and resume](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html).

If an AWS Secrets Manager secret is a JSON object, configure the Elastic Beanstalk secret-backed `DATABASE_PASSWORD` variable to select its top-level `password` field (for example, with the `:password` JSON-key suffix supported by Elastic Beanstalk). Injecting the complete JSON object intentionally fails before PostgreSQL authentication with:

```text
[database] configuration_invalid category=database_password_is_structured_value
```

Never paste the secret value into logs or screenshots to prove this guard. See AWS's [Elastic Beanstalk secrets and parameters documentation](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/AWSHowTo.secrets.env-vars.html) for current console, ARN, permission, and JSON-key requirements.

JSON-key extraction requires an Elastic Beanstalk platform version that supports the feature (AWS documents support for platform versions released on or after January 13, 2026). Confirm the selected Node.js platform before relying on the `:password` suffix.

## Release evidence to record

Before tagging, record:

- branch and approved commit SHA;
- Node.js version and automated-test result;
- degraded and ready-database smoke results;
- outage/recovery result or an explicit reason it was not rerun;
- deployment ZIP entry count and SHA-256;
- Beanstalk, database, HTTPS/DNS, and browser-validation results; and
- known limitations or validation still pending.

Record results in the Release 03 handoff/completion record and summarize them in the release notes. Keep procedures here so they do not diverge across several documents.
