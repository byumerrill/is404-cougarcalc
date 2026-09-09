# CougarCalc Release 03 AWS preparation notes

## Release status

Release 03 prepares the CougarCalc application for a guided deployment to AWS Elastic Beanstalk with Amazon RDS for PostgreSQL. It does not create AWS resources, publish a release, or change DNS by itself.

The starting point was the Release 2 PostgreSQL application. Release 02 assumed that PostgreSQL had to be fully configured and ready before the web server could start. That was reasonable for a local database exercise, but it was not a good fit for the planned AWS learning sequence. The Beanstalk application needs to be deployable and testable before RDS is connected, and infrastructure health checks need to distinguish a running web process from a usable database path.

Release 03 therefore changes CougarCalc from a database-required application into a calculator that can operate safely in either ready or degraded mode.

## High-level overview

| Area | Release 02 behavior | Release 03 AWS-ready behavior |
| --- | --- | --- |
| Startup | Exited if database configuration, connectivity, schema, or permissions were not ready | Starts the Express application and reports history as unavailable |
| Calculator | Returned `503` when a valid result could not be saved | Returns the result with `saved: false` and a clear warning |
| History | Used PostgreSQL and returned a safe `503` on runtime failures | Keeps the same safe `503` behavior and browser isolation |
| Health | No separate liveness and database-readiness routes | Adds `/health/live` and `/health/ready` with different meanings |
| Database transport | Local non-TLS PostgreSQL only | Adds explicit local non-TLS and verified Amazon RDS TLS modes |
| Timeouts | Relied mainly on library and network defaults | Adds bounded connection, query, and readiness timeouts |
| Database diagnostics | Generic database-unavailable messages | Adds safe structured categories, readiness stages, bounded repetition, and recovery events |
| Load-balancing visibility | No way to identify which server answered | Adds a short, non-secret serving-instance marker |
| Deployment artifact | No verified Beanstalk source-bundle process | Adds deterministic allowlist ZIP creation and inspection |
| Node.js version | Required a compatible version but did not declare a major | Declares Node.js 22.x for laptops and Elastic Beanstalk |
| Automated verification | 52 tests | 80 tests plus degraded and real PostgreSQL recovery smoke checks |

## Important design ideas

### Liveness is different from readiness

`GET /health/live` answers one narrow question: is the Express process running and able to answer HTTP requests? It returns `200` even when PostgreSQL is absent.

`GET /health/ready` answers a broader question: can CougarCalc connect to PostgreSQL and use the required schema and runtime permissions? It returns `503` until the complete history path works.

This separation matters in AWS. Beanstalk can initially check liveness while the course validates the application without RDS. After RDS, migration, roles, and networking are verified, the health check can deliberately move to readiness.

### Degraded mode keeps the useful part of the application working

The calculator does not need PostgreSQL to evaluate arithmetic. If a save fails, Release 03 returns the valid result and makes the loss of persistence explicit:

```json
{
  "result": 14,
  "saved": false,
  "warning": "History is temporarily unavailable; this calculation was not saved."
}
```

The unsaved calculation is not queued or inserted later. This keeps recovery behavior simple and honest: after the database recovers, new calculations can be saved, but calculations made during the outage remain unsaved.

### Browser HTTPS and database TLS solve different problems

The browser will eventually use HTTPS to the Application Load Balancer. That protects public web traffic and allows the anonymous history cookie to use `Secure`.

The Node application separately uses verified TLS to Amazon RDS. That protects database traffic and verifies that the application reached a server whose certificate is trusted for the configured RDS DNS hostname.

Release 03 keeps these settings separate:

- `HISTORY_COOKIE_SECURE=false` for initial HTTP validation and `true` after HTTPS works.
- `DATABASE_TLS_MODE=disable` for explicit local non-TLS PostgreSQL.
- `DATABASE_TLS_MODE=verify-full` with `DATABASE_CA_PATH` for Amazon RDS.

## File-by-file change summary

### Application and configuration files

#### `app.js`

Why it changed: Release 02 treated PostgreSQL readiness as a requirement for starting the HTTP server. AWS validation needs the application to start before RDS is configured and to survive temporary database failures.

What changed:

- Startup now checks whether the five database connection settings are complete.
- Missing or partial database configuration selects an unavailable-history repository instead of inventing fake credentials or exiting.
- Invalid complete database or TLS configuration starts degraded and logs a safe diagnostic category.
- A configured PostgreSQL repository is retained even if its initial readiness check fails. This lets later requests recover when a temporary outage ends.
- `POST /calculate` still returns the original `{ "result": ... }` response after a successful save. A save failure now returns the result, `saved: false`, and a warning instead of discarding the result behind a `503`.
- `GET /history` retains its safe `503` behavior when persistence is unavailable.
- `GET /health/live` returns a small `200` response whenever Express is running.
- `GET /health/ready` checks database connectivity, schema, and permissions and returns either `200` or `503` without exposing the failure detail.
- Runtime failures retain the caught error only long enough to classify it safely and identify the fixed operation name (`save_calculation`, `retrieve_history`, or `readiness_check`).
- Successful operations clear their prior failure state and log one recovery transition instead of repeating success messages.
- `GET /diagnostics/instance` returns only the short instance marker.
- `X-CougarCalc-Instance` is added to responses so a load-balancing exercise can show which target answered.
- The hostname source and logger can be injected in tests, avoiding dependence on a developer machine or sensitive raw errors.
- Existing strict cookie configuration and graceful server/pool shutdown behavior remain in place.

#### `database.js`

Why it changed: Database setup needed an explicit distinction between intentional local non-TLS use and certificate-verified RDS use. Database operations and health checks also needed prompt failure behavior.

What changed:

- Added a helper that reports only the names of missing database variables.
- Kept strict validation for a complete configuration, including the port range.
- Rejects a parseable JSON object supplied as `DATABASE_PASSWORD` before opening a pool. The safe category directs operators to configure Elastic Beanstalk to extract the secret's top-level `password` field; neither the JSON nor its embedded password is logged.
- Added `DATABASE_TLS_MODE` with only two accepted values: `disable` and `verify-full`.
- Local `disable` mode creates a pool with TLS off and rejects an unexpected CA path.
- `verify-full` mode requires a DNS hostname and a readable PEM file from `DATABASE_CA_PATH`.
- The verified TLS pool supplies Amazon's CA certificates and uses `rejectUnauthorized: true`. Node and `node-postgres` then validate the certificate chain and hostname.
- Uses a 35-second connection timeout so Aurora Serverless v2 has time to resume after a long pause, while retaining a 10-second query timeout.
- Added an unavailable repository that implements the same methods as the PostgreSQL repository. Express therefore uses one interface in both ready and degraded modes.
- Added `checkReadiness()`, which combines connection, exact schema, and minimum-permission checks into one safe boolean result for HTTP callers while recording the internal stage (`connection`, `schema_columns`, `schema_constraint`, `schema_primary_key`, `schema_index`, or `runtime_privileges`).
- Concurrent readiness requests share the same active check, reducing duplicate catalog queries.
- Public readiness has a 10-second overall ceiling. A longer connection attempt may continue in the background and a later readiness request can observe Aurora recovery without restarting Node.js.
- Idle pool errors use the same safe classifier as startup, readiness, and runtime operation failures.
- Existing parameterized save/history SQL, browser-hash validation, exact schema inspection, privilege checks, and pool closure remain intact.

#### `database-diagnostics.js` — new

Why it was added: The first successful AWS deployment proved that generic degraded-mode messages were safe but did not identify whether a failure came from DNS, networking, TLS, authentication, schema validation, privileges, or configuration shape.

What it does:

- Classifies stable Node.js and PostgreSQL error codes into bounded categories such as `dns_failure`, `connection_timeout`, `tls_verification_failed`, `authentication_failed`, `schema_missing_or_invalid`, and `insufficient_privilege`.
- Formats one-line events such as `[database] readiness_failed stage=connection category=authentication_failed code=28P01 retryable=false`.
- Includes the existing short instance marker on database state and failure events so logs from temporarily scaled Beanstalk targets can be distinguished safely.
- Logs the first occurrence of an operation/readiness failure, logs again if its category changes, and logs recovery once. It does not build an external logging framework or emit routine success noise.
- Accepts the existing injectable logger so tests can inspect every emitted line.
- Never serializes raw errors, passwords, connection strings, request bodies, calculation expressions, cookies, browser tokens or hashes, or `process.env`.

#### `instance-marker.js` — new

Why it was added: A temporary multi-instance Beanstalk exercise needs a safe way to show that different targets can answer requests.

What it does:

- Reads the machine hostname through an injectable source.
- Hashes the hostname with SHA-256.
- Returns only the first 12 lowercase hexadecimal characters.
- Never returns the hostname, instance ID, IP address, EC2 metadata, environment variables, or user data.
- Produces a stable marker for one machine and normally different markers for different machines.

#### `.env.example`

Why it changed: Developers and the later AWS walkthrough need to see the new configuration names without committing real values.

What changed:

- Added `DATABASE_TLS_MODE=disable` to the local example.
- Added commented AWS examples for `DATABASE_TLS_MODE=verify-full` and `DATABASE_CA_PATH=database/certs/global-bundle.pem`.
- Continued to use placeholders only.

#### `package.json`

Why it changed: Elastic Beanstalk, developer laptops, and automation should not silently select incompatible Node.js major versions. The source-bundle workflow also needs stable commands.

What changed:

- Declared `engines.node` as `22.x`.
- Added `npm run bundle` for deterministic ZIP creation.
- Added `npm run bundle:inspect` for independent ZIP inspection.
- Added `npm run smoke:degraded` for the no-database application smoke check.
- Added a narrow npm override that keeps `body-parser` transitive while requiring patched version `1.20.6` through Express.
- Kept the existing Express and `pg` dependencies and `npm start` command.

#### `package-lock.json`

Why it changed: The lock file must agree with the root package metadata used by `npm ci`.

What changed:

- Recorded the same Node.js 22.x engine requirement.
- Updated the resolved transitive `body-parser` package from `1.20.5` to patched version `1.20.6`, including its registry integrity value.
- A clean `npm ci` and `npm ls body-parser --all` verify that Express resolves the overridden `1.20.6` package without adding it as a direct application dependency.

#### `debug-check.js`

Why it changed: Instructor troubleshooting benefits from a compact local check, but the prior output included calculation and history bodies that were unnecessary for diagnosing readiness.

What changed:

- Reports only safe readiness status, whether a test calculation was saved, the history entry count, and the existing short instance marker.
- Does not print the calculation expression, result body, cookie, browser token/hash, database configuration, or caught error message.
- Directs the operator to the centralized safe database diagnostics when the check fails.

### Database trust material

#### `database/certs/global-bundle.pem` — new

Why it was added: RDS certificate verification requires a trusted CA bundle on the Beanstalk instance.

What changed:

- Added Amazon's public global RDS CA bundle from the official AWS trust store.
- The bundle is public certificate material, not a password or private key.
- The deterministic deployment builder includes it in the source ZIP.
- Documentation assigns responsibility for reviewing AWS CA rotation notices and updating, testing, and redeploying the bundle before affected certificates expire.

### Browser interface

#### `public/index.html`

Why it changed: A successful-but-unsaved calculation must be understandable to a beginner and accessible to assistive technology.

What changed:

- Added a visually distinct persistence warning below the result.
- Added `role="status"` and `aria-live="polite"` so screen readers can announce the warning without interrupting the user.
- The warning is hidden and cleared during ordinary input and successful persistence.
- When the API returns `saved: false`, the UI shows the server's safe warning while keeping the calculated result visible.
- History still reports its own unavailable state if its request returns `503`.

### Deployment packaging files

#### `.ebignore` — new

Why it was added: EB CLI packaging needs a committed exclusion policy for local and documentation files.

What changed:

- Excludes `.env`, Git data, dependencies, tests, coverage/output, caches, local tools, logs, generated ZIPs, course labs, and unrelated assets.
- Excludes every Markdown file at every directory depth.
- Acts as defense in depth for EB CLI use; it is not assumed to filter ZIPs created by unrelated tools.

#### `.gitignore`

Why it changed: Deployment ZIPs are generated artifacts rather than source files.

What changed:

- Added `dist/` so the candidate ZIP is not accidentally committed.

#### `scripts/deployment-bundle.js` — new

Why it was added: A deterministic allowlist is safer and more teachable than assuming every packaging tool honors `.ebignore`.

What it does:

- Defines the exact 12 runtime files allowed in the Beanstalk source ZIP, including `database-diagnostics.js`.
- Reads only those files and puts them directly at the archive root, without an extra project directory.
- Creates a deterministic ZIP so identical input produces identical archive bytes.
- Reopens the completed ZIP and verifies entry names, sizes, checksums, and required contents.
- Rejects Markdown, `.env`, Git metadata, dependencies, tests, credential-like filenames, parent-directory paths, private keys, AWS-access-key-shaped content, unexpected entries, and missing runtime files.
- Treats the public RDS CA bundle as the one approved PEM certificate file.
- Supports both creation and inspection through the package scripts.

#### `scripts/degraded-smoke.js` — new

Why it was added: The most important pre-RDS AWS behavior should have a quick executable check outside the unit-test helpers.

What it verifies:

- Starts CougarCalc on an environment-provided temporary port with no database configuration.
- Confirms liveness `200` and readiness `503`.
- Confirms a calculation still returns `200`, the correct result, `saved: false`, and the expected warning.
- Closes the HTTP server and unavailable repository cleanly.

#### `scripts/postgres-recovery-smoke.js` — new local release tool

Why it was added: Unit tests can simulate repository failures, but a release candidate also benefits from proving recovery against a real PostgreSQL process.

What it verifies:

- Uses an explicitly configured disposable local PostgreSQL test cluster.
- Confirms ready-mode health, a saved calculation, and browser-cookie-scoped retrieval.
- Stops PostgreSQL while Node remains running.
- Confirms readiness becomes `503` and calculations become explicitly unsaved.
- Restarts PostgreSQL and confirms readiness and new saves recover without restarting Node.
- Confirms the calculation made during the outage is not silently inserted later.
- Is excluded from the deployment ZIP because it is a local release-validation tool, not runtime application code.

### Automated tests

#### `test/app.test.js`

Why it changed: The Release 02 startup and save-failure expectations deliberately changed, and every new public route and response contract needed HTTP-level coverage.

What changed:

- Updated the former persistence-failure test to expect a successful result with explicit unsaved status.
- Added no-database startup and partial-configuration tests.
- Added checks that logs name missing variables without exposing values, passwords, or endpoints.
- Added the exact structured-Secrets-Manager-password regression test and proves its JSON and embedded password never reach logs.
- Added runtime failure tests proving calculation expressions, cookies, browser tokens/hashes, and database passwords never reach logs.
- Added liveness and readiness tests for ready, unavailable, connection-failure, schema-failure, and permission-failure cases.
- Confirmed health routes do not create the anonymous history cookie.
- Added deterministic diagnostic endpoint and response-header checks using an injected hostname.
- Added recovery behavior for a configured repository whose readiness changes after startup.
- Confirms readiness recovery is logged once and carries only the safe instance marker.
- Confirmed the browser page contains the accessible persistence-status markup.
- Retained browser isolation, cookie safety, calculator compatibility, static-file safety, history, and graceful resource tests.

#### `test/database.test.js`

Why it changed: TLS, timeouts, degraded configuration, and runtime readiness are primarily database-layer behavior.

What changed:

- Updated the valid configuration expectation with explicit local TLS mode and approved timeouts.
- Added missing/partial variable-name tests.
- Added local non-TLS pool configuration tests.
- Updated timeout coverage for the 35-second Aurora connection allowance and independent 10-second readiness ceiling.
- Added verified-TLS CA loading and `rejectUnauthorized: true` tests without contacting RDS.
- Added safe invalid-mode, missing-CA, unreadable-CA, malformed-CA, raw-IP, and unexpected-CA tests.
- Added unavailable-repository interface tests.
- Added combined readiness success/failure tests.
- Added a readiness failure test for each of the six fixed readiness stages.
- Added idle-pool diagnostic coverage and structured-password rejection before pool creation.
- Added an overall-readiness-timeout test and confirmed concurrent checks are deduplicated.
- Retained exact schema, constraint, index, privilege, parameterized SQL, mapping, and pool-closure tests.

#### `test/database-diagnostics.test.js` — new

What it verifies:

- Stable classification for representative Node.js and PostgreSQL codes, including `ENOTFOUND`, `ETIMEDOUT`, `28P01`, and `42501`.
- Unknown errors expose at most a short bounded code and never a raw message or error object.
- Repeated identical readiness, operation, and idle-pool failures are suppressed; changed categories and recovery transitions are emitted.
- A distinctive password sentinel and error connection metadata never appear in captured logs.
- Recovery duration and the short instance marker are emitted without exposing hostnames or user data.

#### `test/deployment-bundle.test.js` — new

Why it was added: The release cannot rely on a visual inspection of one ZIP.

What it verifies:

- The ZIP contains exactly the runtime allowlist.
- Files occur at the archive root.
- Two builds from identical source have the same SHA-256 hash.
- Markdown, local state, dependencies, tests, credentials, unsafe paths, unexpected parents, and missing required files fail validation.
- `.ebignore` includes the required exclusion patterns.
- `package.json` and `package-lock.json` agree on Node.js 22.x and expose the bundle commands.
- The manifest override and lock file both require transitive `body-parser@1.20.6`.

#### `test/instance-marker.test.js` — new

Why it was added: Tests must not depend on or reveal the developer machine's real hostname.

What it verifies:

- An injected hostname produces a deterministic 12-character hexadecimal marker.
- Different hostnames normally produce different markers.
- The marker does not contain the raw hostname.
- Missing or invalid hostname input fails safely.

### Documentation files

#### `docs/README.md`

Why it changed: The project overview needed to describe the Release 03 AWS architecture rather than the Release 02 local-only startup model.

What changed:

- Explains degraded and ready modes, both TLS boundaries, all configuration settings, Aurora-aware timeouts, Secrets Manager field extraction, health and diagnostics, safe errors, migrations, Node.js 22, testing, source bundling, and RDS CA maintenance.

#### `docs/RunningTheApp.md`

Why it changed: Developers and the instructor need repeatable commands for local ready mode, local degraded mode, initial Beanstalk validation, RDS configuration, HTTPS transition, troubleshooting, and exact bundle inspection.

What changed:

- Replaced the database-required startup directions with separate ready/degraded workflows.
- Added the exact AWS environment-property names, secret-backed password shape, and ordering of health/cookie transitions.
- Added safe stage/category troubleshooting for RDS TLS, authentication, schema, privileges, and Aurora wake-up.

#### `docs/user-helps/environments.md`

Why it changed: Release 03 introduces meaningful environment differences without changing source code.

What changed:

- Documents application settings, complete/partial database configuration, both TLS modes, local PostgreSQL, pre-RDS Beanstalk, Aurora/RDS-ready Beanstalk, Secrets Manager JSON-key extraction, and post-HTTPS settings.

#### `docs/user-helps/ProjectStructureGuide.md`

Why it changed: New runtime, certificate, packaging, smoke, and test files needed to be visible in the project map.

What changed:

- Added the new files to the tree and explained their roles.
- Updated request flow, startup, diagnostics, UI, repository, deployment, smoke, and test descriptions for Release 03.

#### `docs/user-helps/db-design.md`

Why it changed: The Release 02 schema remains correct, but the meaning and timing of readiness changed.

What changed:

- Explains runtime readiness instead of database-gated HTTP startup.
- Documents the six internal readiness stages, safe diagnostic state transitions, 35/10/10-second timeout model, and explicit local versus RDS TLS configuration.
- Reaffirms that startup never performs DDL.

#### `docs/user-helps/initial_db_setup.md`

Why it changed: The database setup guide previously described RDS TLS as future work and recommended production secret/network choices that were not the settled Release 03 course plan.

What changed:

- Aligns local setup with Node.js 22 and `DATABASE_TLS_MODE=disable`.
- Documents verified RDS TLS as implemented rather than pending.
- Keeps migration `001` as an owner-role operation and the app login least-privileged.
- Documents the Aurora Serverless v2 architecture and secret-backed Beanstalk password variable, including top-level `password` extraction from a JSON secret.
- Leaves public/private RDS access for the guided infrastructure decision instead of guessing it in application code.

#### `docs/user-helps/release-validation.md` — new

Why it was added: Automated tests, degraded checks, real-database checks, destructive recovery validation, bundle inspection, browser checks, and AWS validation have different prerequisites and safety boundaries.

What it does:

- Provides one canonical validation matrix and expected result for every check.
- Warns that `postgres-recovery-smoke.js` may stop/start only an explicitly disposable local PostgreSQL cluster.
- Documents safe `debug-check.js` output, the 12-entry bundle contract, browser isolation, Aurora wake-up behavior, log evidence, and release facts to record.
- Keeps procedures out of the release notes and completion record so they do not diverge.

#### `docs/backlog/requirements.md`

Why it changed: This file is the approved handoff, implementation checklist, decision record, progress log, and completion record.

What changed:

- Checked each item only after implementation and verification.
- Recorded selected configuration names, Node.js major, CA source/hash, test totals, bundle method/hash, local smoke results, and remaining approval or AWS gates.
- Preserved the fact that the working tree already contained an unrelated documentation deletion before Release 03 coding began.

#### `docs/release-notes-release-03-aws.md` — new

This document explains why Release 03 changed, what each intended file contributes, and how the pieces work together. Like every Markdown file, it remains in GitHub and is excluded from the Beanstalk source ZIP.

## Important files that did not need application changes

Several Release 02 files were reviewed and intentionally retained:

- `browser-identity.js` already generated a secure random anonymous token, stored only its SHA-256 hash in PostgreSQL, and strictly parsed `HISTORY_COOKIE_SECURE`.
- `public/calculator-logic.js` already handled calculator input and result formatting independently of persistence.
- `database/migrations/001-create-calculation-history.sql` already defined the correct browser-scoped history schema and index. Release 03 does not edit it or run it automatically.
- `test/browser-identity.test.js`, `test/calculator-logic.test.js`, and `test/migration.test.js` continued to protect those unchanged behaviors.

## Validation result

The reconstructed Release 03 application candidate was validated with:

- clean `npm install` under Node.js 22;
- 82 automated tests passed and 0 failed;
- a degraded-mode smoke test (`npm run smoke:degraded`);
- deterministic bundle creation and independent inspection; and
- a final ZIP containing exactly 12 allowlisted runtime files and no Markdown, `.env`, Git metadata, tests, dependencies, or sensitive/local-only files.

Deployment artifact: `dist/cougarcalc-release-03.zip`  
SHA-256: `70B1A7BEC33989398C6ABC5CC3BB43FC3167E3554EEDC17B0015045D2AA85AB2`

The generated ZIP is intentionally ignored and uncommitted. Real PostgreSQL clean-database and outage/recovery smoke, plus Elastic Beanstalk/Aurora validation, remain explicit follow-up steps before any official tag cutover. Git tagging and public release publication remain later explicit steps after human review of the reconstruction manifest.
