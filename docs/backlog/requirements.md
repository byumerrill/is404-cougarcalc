# CougarCalc Release 03 AWS Development Handoff

**Status:** Original Release 03 candidate successfully deployed to Beanstalk with Aurora/RDS; diagnostics-hardened candidate locally verified and awaiting redeployment/AWS validation before tagging
**Prepared:** August 11, 2026
**Target release:** `release-03-aws`
**Target working branch:** `wip-release3-aws`

## Purpose

This document transfers the approved Release 03 application work into a Codex session opened on the private CougarCalc authoring repository. It is both the implementation brief and the visible progress checklist.

The original candidate reached AWS Elastic Beanstalk and a separately managed Aurora/RDS PostgreSQL-compatible database successfully. The immediate goal is now to redeploy and validate the diagnostics-hardened candidate before the official tag. DNS and HTTPS use the separately governed plan for `cougarcalc.prof.is404.net`, Cloudflare authoritative DNS, and an AWS Certificate Manager certificate attached to the Beanstalk Application Load Balancer.

Do not create, replace, or materially reconfigure AWS resources merely because this document was opened. Review the diagnostics-hardened candidate first, then continue professor-guided AWS validation one major step at a time.

## Repository boundary

There are two repositories and two local clones with different purposes.

### Private authoring repository — make changes here

- Current local path: `C:\vscode-projects\cougarcalc`
- GitHub remote: `https://github.com/byumerrill/cougarcalc.git`
- Purpose: instructor development, testing, and release preparation
- Expected starting branch: `main`
- Expected starting commit: `a362f4f12f2251bd43719f7b932a11828eb8c4ff`
- Expected starting tag: `release-02-postgres`

### Public student repository — do not develop here

- Local walkthrough path: `C:\Users\merrill3\is404\is404-cougarcalc`
- GitHub remote: `https://github.com/byumerrill/is404-cougarcalc.git`
- Purpose: the clean repository students clone and the professor uses to rehearse labs as a student
- Do not modify this clone during Release 03 development.
- Publish to the public repository only after the private release candidate is approved, following the established release workflow.

## Governing course context

If this handoff is moved into the private repository, the larger architecture records remain in:

- `C:\Users\merrill3\github-projects\teammate-stack\07-is404-CougarCalc-deployment-learning-model.md`
- `C:\Users\merrill3\github-projects\teammate-stack\08-is404-CougarCalc-github-tagging-release-workflow.md`
- `C:\Users\merrill3\github-projects\teammate-stack\13-is404-aws-beanstalk-direct-service-interactions.md`
- `C:\Users\merrill3\github-projects\teammate-stack\14-is404-CougarCalc-Beanstalk-cicd-options.md`
- `C:\Users\merrill3\github-projects\teammate-stack\19-DNS-cloudflare-context.md`
- `C:\Users\merrill3\github-projects\teammate-stack\70-lab-authoring-instructions.md`
- `C:\Users\merrill3\github-projects\teammate-stack\80-optional-aws-free-account-initial-setup.md`
- `C:\Users\merrill3\github-projects\teammate-stack\83-cougarcalc-managed-node-beanstalk-lab.md`
- `C:\Users\merrill3\github-projects\teammate-stack\84-cougarcalc-managed-node-cicd-template.md`
- `C:\Users\merrill3\github-projects\teammate-stack\85-cougarcalc-load-balancer-exercise.md`

This is professor-facing development work. Do not silently turn it into a student lab, and do not rewrite the wider course architecture unless a discovered implementation constraint requires a deliberate decision.

## Collaboration rules for the new Codex session

- Work in small, reviewable increments and keep this checklist current.
- Explain meaningful implementation choices in beginner-friendly language.
- Do not create, replace, or materially reconfigure AWS resources without the professor confirming that specific guided step.
- Never write, display, commit, or test with real passwords, AWS credentials, cookies, tokens, or private keys.
- Preserve unrelated user changes in a dirty working tree. Stop if changes overlap this work and cannot be safely separated.
- Use a working branch. Do not commit directly to `main`.
- Do not push, merge, tag, publish to the public repository, or create a GitHub release without explicit professor approval at that stage.
- Treat Node.js 22 and the deterministic allowlist bundle as settled. Do not guess deployment-specific Aurora/RDS networking or account configuration where it is not recorded.
- Keep Release 01 and Release 02 behavior working unless Release 03 explicitly changes it.

## Verified Release 02 baseline

The private authoring repository was last observed clean on `main`, exactly at tag `release-02-postgres` and commit `a362f4f`.

The existing application:

- is Node.js with Express and `node-postgres`;
- uses `npm start` -> `node app.js`;
- reads the Beanstalk-compatible `PORT` environment variable already;
- defaults the listener host to `0.0.0.0` when `HOST` is absent;
- requires five `DATABASE_*` variables;
- verifies PostgreSQL connectivity, schema, and runtime permissions before listening;
- exits when PostgreSQL is unavailable or not ready;
- stores browser-scoped calculation history using a secure random cookie token whose hash is stored in PostgreSQL;
- returns safe `503` responses for database failures after startup;
- supports `HISTORY_COOKIE_SECURE=true|false`;
- has migration `database/migrations/001-create-calculation-history.sql`; and
- does not currently configure PostgreSQL TLS.

The full existing suite passed on August 11, 2026:

```text
52 tests
52 passed
0 failed
```

On Windows, use `npm.cmd test` if PowerShell execution policy prevents `npm.ps1` from running.

## Settled Release 03 architecture

The intended request path is:

```text
Browser
  -> Cloudflare DNS for cougarcalc.prof.is404.net
  -> AWS Application Load Balancer
      -> HTTP listener redirects to HTTPS after HTTPS is ready
      -> HTTPS listener terminates TLS with ACM certificate
  -> target group
  -> one normal Elastic Beanstalk EC2 target
  -> Beanstalk-managed proxy
  -> Node.js / Express over internal HTTP
  -> Amazon RDS for PostgreSQL over verified TLS
```

The Beanstalk environment will be **load-balanced, scalable**, normally with one target. It is not a single-instance Beanstalk environment because the Application Load Balancer is required for HTTPS and for the temporary multi-target learning exercise.

## Affirmed application decisions

Every decision in this section was explicitly affirmed by the professor.

### Degraded operation before RDS

- CougarCalc must start when database configuration is missing, incomplete, or temporarily unusable.
- The calculator must continue working.
- History must clearly report that it is temporarily unavailable.
- A calculation made while persistence is unavailable is returned to the user but is not saved or recovered later.
- The response/UI must clearly say that the calculation was not saved.
- Adding valid database environment properties later may restart the Beanstalk application, but must not require a source-code change or a new bundle.

### Separate health meanings

- `GET /health/live` returns HTTP `200` whenever the Express application is running, independent of RDS.
- `GET /health/ready` returns HTTP `200` only when PostgreSQL is reachable and the required schema and application permissions are usable.
- `GET /health/ready` returns HTTP `503` while database configuration is missing/incomplete or PostgreSQL is unavailable/not ready.
- Public health responses must be small and must not expose configuration, endpoints, credentials, SQL, stack traces, or internal errors.
- Initial Beanstalk health checking will use `/health/live`; after RDS is working it will deliberately switch to `/health/ready`.

### Safe degraded configuration

- All five missing database settings may be treated as an intentional no-database configuration.
- Partial database configuration also starts degraded.
- Server logs may name missing variable names, such as `DATABASE_PASSWORD`, but must never print their values.
- Public responses must not identify missing variable names or internal connection details.

### Prompt failure behavior

- Use a 35-second database connection timeout so Aurora Serverless v2 can resume after a long pause.
- Use a 10-second database query timeout.
- Keep the public readiness request independently bounded at 10 seconds. A shared connection attempt may continue after a readiness response returns `503`, and a later request may observe recovery.
- Do not retry permanent failures such as PostgreSQL authentication code `28P01` with unchanged configuration.

### RDS transport security

- AWS database connections must use TLS with server-certificate verification.
- Local PostgreSQL development may remain non-TLS.
- Use Amazon's public RDS CA bundle; it is not a secret.
- Do not use `rejectUnauthorized: false` as the normal AWS solution.
- The configuration interface must make local non-TLS versus AWS verified TLS explicit and testable.
- Do not print the CA contents or sensitive connection configuration in logs.

The selected interface is `DATABASE_TLS_MODE=disable|verify-full` plus `DATABASE_CA_PATH` in verified mode. TLS is never guessed from the hostname.

### Browser history cookie

- Use `HISTORY_COOKIE_SECURE=false` for the initial HTTP-only Beanstalk validation.
- Change it to `true` after the custom hostname and HTTPS are working.
- Preserve the existing strict parsing that accepts only exact `true` or `false` values.

### Database ownership and migrations

- Do not automatically create or alter the schema during web application startup.
- Apply migration `001` deliberately with the separate database-owner role.
- Run the application with the lower-privilege application role, limited to the required `SELECT`, `INSERT`, schema `USAGE`, and identity-sequence access.
- Public versus private RDS accessibility and the exact migration execution path remain infrastructure decisions for the later guided RDS walkthrough.

### Load-balancing diagnostic marker

- Add a short, non-secret serving-instance marker.
- Expose it in an `X-CougarCalc-Instance` response header and a small `GET /diagnostics/instance` endpoint.
- Derive it as a short one-way hash of the machine hostname so different EC2 targets normally produce different markers without exposing the raw hostname, instance ID, IP address, or metadata.
- The marker should be stable for the life of a machine and must contain no secret or user data.
- Tests must inject or control the marker source rather than depending on the developer machine's real hostname.

### Managed Node.js source bundle

- Deploy a Node.js source bundle, not a Docker image.
- Include application source, `package.json`, lock file, required static assets, migration, verified RDS CA material, and approved Beanstalk configuration.
- Exclude `.env`, `.git`, `node_modules`, tests, test output, local tools/caches, and unrelated files.
- Exclude **every Markdown file** from the deployed ZIP. Documentation remains in GitHub, not on the Beanstalk instances.
- Required application files must be at the ZIP root, not inside an extra parent directory.
- Commit `.ebignore`, but verify the actual bundling path. `.ebignore` cannot retroactively filter a ZIP assembled by unrelated tooling.
- Before settling the implementation, choose and test either:
  - EB CLI bundle creation that honors `.ebignore`; or
  - a small deterministic allowlist packaging script/workflow that produces and inspects the ZIP.
- Do not assume the GitHub deployment action automatically applies `.ebignore`; inspect the action's current packaging contract.

### Node.js runtime

- Declare an instructor-approved Node.js major version in `package.json` so laptops, GitHub Actions, and Beanstalk do not silently use incompatible major versions.
- Node.js 22 is the selected supported LTS major and is declared as `22.x`.
- Verify the current Elastic Beanstalk Node.js 22 platform in `us-west-2` before a new environment or platform upgrade.
- Prefer a supported long-term-support line that also supports the application's use of `process.loadEnvFile()`.

### Environment configuration and secrets

- Use Elastic Beanstalk environment properties for non-secret application configuration and a secret-backed `DATABASE_PASSWORD` variable for the least-privilege database password.
- When the Secrets Manager value is a JSON credential object, configure Elastic Beanstalk to select its top-level `password` field rather than injecting the complete object.
- Reject an obvious structured JSON object before PostgreSQL authentication and log only the safe `database_password_is_structured_value` category.
- Never commit the password or secret ARN/value or include it in the source bundle, screenshots, logs, test fixtures, or documentation examples.

### Automated verification

- Retain all 52 Release 02 tests unless a deliberately changed expectation requires a clear replacement.
- Add tests for every AWS-facing behavior described in this document.
- A Release 03 tag cannot be created until the complete automated suite and source-bundle inspection pass.

### Pre-tag database diagnostics hardening

The first successful AWS deployment exposed a troubleshooting gap and superseded the earlier generic-log design:

- Route every startup, readiness, runtime-operation, and idle-pool database failure through one safe classifier.
- Prefer stable Node.js and PostgreSQL codes over message text.
- Log fixed readiness stages, operation names, safe categories, bounded codes, retryability, elapsed time when relevant, and the existing short instance marker.
- Keep `/health/ready` generic and never log raw errors, credentials, connection configuration, request/user data, or the complete environment.
- Suppress repeated identical failures; log category changes and recovery transitions once.
- Detect a JSON object supplied as `DATABASE_PASSWORD` and direct the operator toward Secrets Manager top-level field extraction without recording secret metadata.
- Keep diagnostic output injectable and directly security-testable.
- Include `database-diagnostics.js` in the deterministic runtime bundle.

## Implementation checklist

Update this section continuously. Use `[x]` only when the item is completed and verified, not merely attempted.

### 1. Protect the baseline

- [x] Read this handoff completely in the new Codex session.
- [x] Read any repository-local `AGENTS.md` or other standing instructions.
- [x] Confirm the current working directory is `C:\vscode-projects\cougarcalc`.
- [x] Confirm `origin` is the private `byumerrill/cougarcalc` repository.
- [ ] Confirm `main` is clean and at `release-02-postgres` / `a362f4f`. The commit and tag were exact, but `main` was not clean when this session began: this handoff was modified and `docs/resolved-bugs-enhancements.md` was already deleted.
- [x] Run the untouched Release 02 suite and confirm all 52 tests pass.
- [x] Create and switch to `wip-release3-aws` from the Release 02 commit.
- [x] Confirm the public student clone remains untouched.

### 2. Design the smallest cohesive change

- [x] Inspect `app.js`, `database.js`, `browser-identity.js`, the frontend files, tests, migration, and current documentation before editing.
- [x] Identify a clean database availability abstraction so missing configuration does not require fake credentials or scattered conditionals.
- [x] Decide and document explicit TLS configuration variable names.
- [x] Decide how readiness verifies connection, schema, and privileges without leaking errors.
- [x] Decide how the browser UI represents a successful-but-unsaved calculation.
- [x] Decide how the instance marker source is injected for deterministic tests.
- [x] Present any material design choice not already settled here to the professor before implementing it.

### 3. Implement degraded startup and database behavior

- [x] Permit startup with no `DATABASE_*` variables.
- [x] Permit startup with partial `DATABASE_*` variables while logging only missing variable names.
- [x] Preserve strict validation when configured values are malformed, but convert database configuration failures into safe degraded state rather than process exit.
- [x] Keep the database pool/repository capable of succeeding after a normal Beanstalk restart with corrected environment properties.
- [x] Keep calculator evaluation functional without the database.
- [x] Return a successful calculation plus an explicit unsaved warning when persistence is unavailable.
- [x] Update the browser UI to show the unsaved warning accessibly and clearly.
- [x] Keep history failures as safe HTTP `503` responses with no sensitive details.
- [x] Preserve successful saving and browser-scoped history when the repository is ready.
- [x] Preserve graceful HTTP-server and pool shutdown behavior.

### 4. Implement health endpoints

- [x] Add `GET /health/live` with HTTP `200` independent of database state.
- [x] Add `GET /health/ready` with HTTP `200` only for usable database connection, schema, and runtime privileges.
- [x] Return HTTP `503` from readiness for missing, partial, unreachable, or unready database state.
- [x] Keep both bodies small, stable, and non-sensitive.
- [x] Ensure health endpoints do not establish a browser-history cookie.
- [x] Ensure health checks complete within the approved timeouts.

### 5. Implement database TLS and timeouts

- [x] Add explicit local non-TLS and AWS verified-TLS configuration modes.
- [x] Add the Amazon RDS CA bundle through a reviewed, reproducible source and location.
- [x] Configure `node-postgres` to verify the RDS certificate and hostname.
- [x] Do not use certificate verification bypass as the Release 03 AWS path.
- [x] Configure a 35-second Aurora-aware connection timeout with an independent 10-second public readiness ceiling.
- [x] Configure a 10-second query timeout.
- [x] Confirm local Release 02-style PostgreSQL remains usable without TLS when explicitly configured for local development.
- [x] Document certificate rotation/update responsibility without exposing configuration values.

### 6. Implement the non-secret instance marker

- [x] Compute a short one-way hash from the machine hostname.
- [x] Add `X-CougarCalc-Instance` to appropriate HTTP responses.
- [x] Add `GET /diagnostics/instance` returning only the marker in a small response.
- [x] Confirm the raw hostname, IP address, EC2 metadata, environment variables, and secrets are never returned.
- [x] Confirm the marker is deterministic for a supplied hostname and differs for different supplied hostnames.

### 7. Define and verify the source bundle

- [x] Add `.ebignore` covering `.env`, `.git`, `node_modules`, tests, caches/output, local tools, and all `*.md` files at every depth.
- [x] Confirm whether the chosen manual and CI/CD packaging mechanisms honor `.ebignore`.
- [x] If necessary, add a deterministic packaging script or allowlist rather than relying on an ignored file implicitly.
- [x] Ensure required files occur at the archive root.
- [x] Include required application source, static assets, manifests, migration, CA bundle, and approved platform configuration.
- [x] Inspect the ZIP file listing automatically.
- [x] Fail validation if any Markdown file, `.env`, Git metadata, dependency directory, credential-like file, or extra parent directory appears.
- [x] Fail validation if any required runtime file is absent.
- [x] Do not commit a generated deployment ZIP unless the release process explicitly requires it.

### 8. Select and declare Node.js

- [ ] During the AWS walkthrough, verify current Elastic Beanstalk Node.js platform availability in Oregon (`us-west-2`). AWS's current supported-platform documentation lists Node.js 22 AL2023, but the local environment has no AWS CLI, so the region-specific API check remains for the guided walkthrough.
- [x] Select the instructor-approved supported LTS major: Node.js 22.
- [x] Add the compatible `engines.node` declaration to `package.json`.
- [x] Keep GitHub Actions and local setup documentation aligned with that version. No GitHub Actions workflow exists yet; documentation uses Node.js 22.
- [x] Re-run `npm ci`, tests, and degraded-start smoke validation with the selected version. Clean install, 80 tests, degraded smoke, and 12-entry bundle inspection passed on Node.js 22.23.2 after diagnostics hardening.

### 9. Automated tests

- [x] Preserve or deliberately update every existing Release 02 test.
- [x] Test startup with all database variables absent.
- [x] Test startup with partial database configuration and safe logging.
- [x] Test `/health/live` returns `200` without a database.
- [x] Test `/health/ready` returns `503` without configuration.
- [x] Test `/health/ready` returns `503` for connection, schema, or permission failure.
- [x] Test `/health/ready` returns `200` for a ready repository.
- [x] Test health endpoints do not set the history cookie.
- [x] Test a degraded calculation returns the result and explicit not-saved status/warning.
- [x] Test a ready calculation retains the existing save-before-success behavior.
- [x] Test history remains browser-scoped in ready mode.
- [x] Test public errors and captured logs do not contain injected passwords, tokens, hashes, endpoints, SQL details, or stack traces.
- [x] Test local non-TLS pool configuration.
- [x] Test verified-TLS pool configuration, CA loading, and approved timeouts without contacting real RDS.
- [x] Test invalid TLS configuration safely.
- [x] Test deterministic and non-revealing instance markers.
- [x] Test the diagnostic endpoint and response header.
- [x] Test deployment-bundle inclusions and exclusions.
- [x] Test stable safe classification for representative Node.js and PostgreSQL error codes.
- [x] Test each fixed readiness stage and preserve the generic public readiness response.
- [x] Test structured JSON password rejection before pool creation.
- [x] Test that passwords, expressions, cookies, browser tokens/hashes, raw errors, and environments never appear in diagnostics.
- [x] Test repeated-failure suppression, category changes, idle-pool errors, and one-time recovery transitions.
- [x] Run the complete suite from a clean dependency installation where practical.
- [x] Record final test count and results in this handoff.

### 10. Documentation

- [x] Update `.env.example` with names and safe placeholder values only.
- [x] Update the running guide for local ready mode and AWS degraded mode.
- [x] Document `/health/live`, `/health/ready`, and `/diagnostics/instance` in plain language.
- [x] Document the difference between browser-to-ALB HTTPS and application-to-RDS TLS.
- [x] Document `HISTORY_COOKIE_SECURE=false` for initial HTTP and `true` after HTTPS.
- [x] Document that migration `001` remains a deliberate owner-role operation.
- [x] Document safe error/log expectations.
- [x] Document the exact bundle creation and inspection command.
- [x] Add one canonical release-validation guide covering every smoke test, prerequisites, safety boundaries, and expected evidence.
- [x] Confirm all Markdown remains in GitHub but is excluded from the deployed ZIP.
- [x] Do not add real AWS resource identifiers, passwords, endpoints, tokens, or cookies.

### 11. Local release-candidate validation

- [ ] Confirm `git status` contains only intended Release 03 changes. All implementation changes are intended, but the pre-existing deletion of `docs/resolved-bugs-enhancements.md` remains preserved and unrelated.
- [x] Review the diff for secrets and unrelated edits.
- [x] Run `npm ci` successfully from the committed manifest and lock file.
- [x] Run the complete automated suite successfully.
- [x] Start without database configuration using the documented command and an environment-provided port.
- [x] Verify calculator success, unsaved notice, liveness `200`, and readiness `503`.
- [x] Start against a properly migrated local PostgreSQL database.
- [x] Verify saved history, browser isolation, liveness `200`, and readiness `200`. The PostgreSQL 17 integration smoke verified real persistence/liveness/readiness; automated HTTP tests verified separate browser histories.
- [x] Stop PostgreSQL after startup and verify safe, prompt degraded behavior.
- [x] Restore PostgreSQL and verify recovery behavior expected by the chosen design.
- [ ] Rerun the disposable PostgreSQL outage/recovery smoke against the diagnostics-hardened candidate, or explicitly record instructor acceptance of the earlier result before tagging.
- [x] Build and inspect the exact candidate source bundle.
- [x] Confirm the generated bundle contains no Markdown or sensitive/local-only files.
- [x] Present the implementation summary, final diff, tests, limitations, and open infrastructure decisions to the professor.

### 12. Git and release gates

- [ ] Obtain professor approval before committing if the session's working agreement requires it.
- [ ] Commit the reviewed work on `wip-release3-aws` with a focused message.
- [ ] Push the working branch only after explicit approval.
- [ ] Open/review/merge the private pull request only after explicit approval.
- [ ] Confirm private `main` is clean on the approved Release 03 commit.
- [ ] Create annotated tag `release-03-aws` only after local and instructor AWS validation pass.
- [ ] Never move or reuse the tag after publication.
- [ ] Record the full approved commit SHA, test count, Node major, bundle method, and known limitations.
- [ ] Publish the approved commit and tag to the public student repository only after explicit approval.
- [ ] Rehearse from a fresh public clone before publishing the student assignment.

## Required response behavior

Exact JSON wording may be chosen during implementation, but behavior must remain stable and testable. Prefer simple response shapes such as:

```json
{"status":"live"}
```

```json
{"status":"ready"}
```

```json
{"status":"not ready"}
```

For degraded calculations, preserve the existing result while explicitly signaling that it was not persisted. For example:

```json
{
  "result": 14,
  "saved": false,
  "warning": "History is temporarily unavailable; this calculation was not saved."
}
```

Do not adopt these exact fields blindly if the existing frontend contract suggests a cleaner compatible design; whichever design is chosen must be explicit, documented, and tested.

## Out of scope for the initial code change

Do not add these merely because they are common cloud features:

- Docker or Amazon ECR for the AWS deployment path
- Route 53 authoritative DNS
- a custom VPC
- a NAT Gateway
- automatic schema migration at application startup
- AWS access keys in code or GitHub secrets
- authentication/user accounts for CougarCalc
- additional secret-management platforms beyond the implemented Elastic Beanstalk and Secrets Manager integration
- CloudFront, WAF, Shield Advanced, or Global Accelerator
- infrastructure as code
- public/private RDS selection before the guided infrastructure decision
- production observability beyond the bounded health, log, and diagnostic requirements

## Infrastructure decisions and remaining validation

The successful first deployment resolved some of these choices in AWS, but account-specific identifiers and values are intentionally not copied into this repository. Re-verify them during the guided hardened-candidate deployment rather than guessing:

- the exact supported Beanstalk Node.js platform version in `us-west-2`;
- whether the instructor RDS instance is private or publicly addressable with narrow Security Group rules;
- the exact safe path used to run migration `001` against RDS;
- exact RDS instance class/version/storage selections under the account's current Free Plan and credits;
- Beanstalk service role and EC2 instance profile creation;
- Beanstalk application/environment names;
- RDS and Beanstalk Security Group relationship;
- GitHub OIDC role and immutable action pins;
- Cloudflare record creation;
- ACM certificate request and validation CNAME;
- HTTPS listener and HTTP-to-HTTPS redirect;
- switching `HISTORY_COOKIE_SECURE` to `true`;
- switching Beanstalk health from `/health/live` to `/health/ready`; and
- temporary scaling, cleanup, snapshots, and billing verification.

## Known AWS and DNS context for later

- AWS region selected provisionally: Oregon, `us-west-2`.
- AWS sign-in uses the professor IAM administrator `prof-admin`, not root for daily work.
- Root MFA and additional MFA devices are configured.
- No IAM access keys were created.
- A monthly AWS cost budget exists and the account earned the initial $20 activity credit.
- Alternate billing, operations, and security contacts are configured.
- The AWS account currently uses the Free Plan; exact service eligibility and the six-month/credit limits must be rechecked before resource creation.
- Instructor hostname: `cougarcalc.prof.is404.net`.
- Cloudflare is authoritative for `is404.net`; do not use Route 53 as authoritative DNS.
- Cloudflare plan is Free, DNSSEC is currently disabled, and the last observed quota was 18 of 200 DNS records used.
- Application record will be DNS-only initially and will CNAME to the exact Beanstalk environment hostname.
- ACM uses a separate DNS-validation CNAME retained while the hostname/certificate remains in use.
- TLS terminates at the AWS Application Load Balancer; the internal ALB/proxy/application hop remains managed HTTP.

## Progress log

Add short dated entries here when a meaningful milestone or decision occurs. Never paste secrets or raw sensitive logs.

- **2026-08-11:** Release 02 private baseline and 52 passing tests verified read-only. Release 03 decisions above affirmed. Implementation not started because the original Codex session did not have write access to the private authoring repository.
- **2026-08-11:** Read the updated handoff completely and found no repository-local `AGENTS.md` or standing files under `.agents`. Verified the private repository path, `origin`, exact Release 02 commit and tag, and all 52 untouched baseline tests. Created `wip-release3-aws` at `a362f4f`. Preserved the pre-existing handoff modification and deletion of `docs/resolved-bugs-enhancements.md`; because of those documentation changes, the literal clean-`main` checklist condition remains open. Confirmed the public student clone is clean at the same commit and did not modify it.
- **2026-08-11:** Completed the Release 03 application design review before code edits. Chose one repository interface with configured and unavailable implementations; configured readiness rechecks connectivity, exact schema, and minimum privileges so PostgreSQL can recover after startup. Chose `DATABASE_TLS_MODE=disable|verify-full` and `DATABASE_CA_PATH`, a successful degraded calculation response with `saved: false` and a public warning, an accessible live UI notice, and an injected hostname source for deterministic instance-marker tests. Public readiness responses and logs will contain only bounded safe messages.
- **2026-08-11:** Implemented and verified degraded startup/calculation behavior, separate liveness and database readiness, safe recovery checks, explicit local and verified-RDS TLS modes, 5-second connection and 10-second query timeouts, and a 12-hex-character hostname hash exposed through the diagnostic header and endpoint. Downloaded the public Amazon RDS global CA bundle from the official AWS trust store; it contains 108 certificates and had SHA-256 `E5BB2084CCF45087BDA1C9BFFDEA0EB15EE67F0B91646106E466714F9DE3C7E3` when reviewed. Complete suite: 65 passed, 0 failed.
- **2026-08-11:** Added `.ebignore` and a deterministic allowlist ZIP builder/inspector used identically by manual and future CI execution (`npm run bundle` and `npm run bundle:inspect`). Verified exactly 11 required root-relative runtime files and rejection of Markdown, environment files, Git/test/dependency paths, credential-like files, unexpected parent paths, missing files, private keys, and AWS-access-key-shaped content. Generated output is ignored by Git.
- **2026-08-11:** Selected Node.js 22 LTS after reviewing AWS's current Elastic Beanstalk supported-platform and retirement documentation; declared `22.x` in both package manifests. Verified `process.loadEnvFile()`, all 69 tests, degraded startup, and bundle creation/inspection with Node.js 22.23.2. Region-specific `us-west-2` confirmation remains deferred because this workstation has no AWS CLI; no AWS resources or account data were accessed.
- **2026-08-11:** Tightened readiness to a deduplicated 10-second overall ceiling and required a DNS hostname in verified TLS mode so hostname verification cannot be skipped with a raw IP. Expanded the complete suite to 70 passing tests.
- **2026-08-11:** Updated the environment example and professor-facing running, architecture, environment, project-structure, database-design, and initial-database guides for Release 03. Documentation now covers local ready mode, AWS degraded mode, health/diagnostic contracts, both TLS boundaries, initial and post-HTTPS cookie modes, owner-only migration, safe logs, RDS CA rotation, course-simplified secrets handling, and deterministic ZIP creation/inspection. Verified the ZIP contains no Markdown.
- **2026-08-12:** Completed clean release-candidate validation on Node.js 22.23.2: `npm ci` succeeded, all 70 tests passed, and degraded smoke returned calculation/liveness `200`, readiness `503`, and `saved: false`. A disposable local PostgreSQL 17 cluster used an owner-applied migration and restricted app role; it verified liveness/readiness `200`, persisted `6 * 7`, degraded safely during a live outage, recovered after restart, persisted `10 * 10`, and did not recover the unsaved outage calculation. The disposable cluster was stopped and removed. The in-app browser was unavailable, so rendered UI interaction was not performed; HTTP smoke and automated accessibility assertions verified the warning contract and live status markup.
- **2026-08-12:** Rebuilt and independently inspected the exact deterministic candidate ZIP. It contains exactly 11 allowlisted runtime files at the archive root, contains no Markdown or sensitive/local-only entries, is ignored by Git, and has SHA-256 `AD9EE7E4848B035F94121B4B3FD7F3E54C28C2CC6276D24AC541D2B176390428`.
- **2026-08-12:** Added `docs/release-notes-release-03-aws.md` as a medium-detail learning document. It compares Release 02 with the AWS-ready design, explains the major architectural decisions, summarizes every intended Release 03 file change and its reason, identifies important reviewed-but-unchanged files, records validation results, and explicitly excludes the pre-existing unrelated documentation deletion from the release scope. The Markdown release notes remain excluded from the deployment ZIP by both `.ebignore` and the deterministic allowlist.
- **2026-08-12:** Added a narrow npm override for patched transitive `body-parser@1.20.6`, regenerated the lock file, and verified the clean installed tree resolves `express@4.22.2 -> body-parser@1.20.6 overridden`. npm audit reported 0 vulnerabilities. All 70 tests passed on Node.js 22.23.2, and the rebuilt/inspected 11-file candidate ZIP has SHA-256 `902EDF5359FC6D514D5DB583C0AA65839B144D214CC32E79FA80E8EA7EF0F4C5`.
- **2026-08-13:** After the original candidate successfully deployed to Elastic Beanstalk and connected to Aurora/RDS, implemented the pre-tag diagnostics hardening learned during instructor troubleshooting. Added centralized safe classification, six readiness stages, structured-JSON password rejection, safe configuration context, instance-aware failure/recovery transitions, bounded duplicate logging, idle-pool diagnostics, a 35-second Aurora connection allowance with a 10-second public readiness ceiling, and a safe `debug-check.js` summary. Clean `npm ci` found 0 vulnerabilities; all 80 tests, degraded smoke, bundle build, and independent inspection passed on Node.js 22.23.2. The bundle now has 12 exact entries and SHA-256 `53515476CC5AB88E1AE6EC1426259AC2F5FA2C02AF78D83504020FA729966645`. The real PostgreSQL outage/recovery smoke result below belongs to the earlier candidate and must be rerun or explicitly accepted before tagging the hardened candidate.
- **2026-08-13:** Added `docs/user-helps/release-validation.md` as the canonical validation playbook and aligned the operational, environment, database, project-structure, setup, release-note, and handoff documentation with Secrets Manager JSON-key extraction, Aurora wake-up timing, safe diagnostic fields, and current test/bundle facts. Earlier dated entries remain unchanged as historical evidence.

## Completion record

Fill this in only after the corresponding facts are verified.

```text
Working branch: wip-release3-aws
Release candidate commit:
Final approved commit:
Annotated tag:
Node.js major: 22
Automated test result: 80 passed, 0 failed on Node.js 22.23.2 after clean npm ci
Bundle-generation method: Deterministic allowlist builder via npm run bundle
Bundle inspection result: Passed; 12 exact root-relative entries; SHA-256 53515476CC5AB88E1AE6EC1426259AC2F5FA2C02AF78D83504020FA729966645
Local degraded smoke result: Passed; calculation/liveness 200, readiness 503, explicit saved false warning
Local PostgreSQL-ready smoke result: Earlier candidate passed on disposable PostgreSQL 17, including outage and recovery; hardened candidate rerun or explicit acceptance pending
Instructor Beanstalk result: Earlier candidate deployed successfully; diagnostics-hardened candidate redeployment pending
Instructor RDS result: Earlier candidate connected successfully to Aurora/RDS; diagnostics-hardened candidate validation pending
HTTPS/DNS result:
Public repository publication result:
Known limitations: Diagnostics-hardened Beanstalk/Aurora validation, the real PostgreSQL recovery-smoke rerun or explicit acceptance, HTTPS/DNS, Git release gates, and public publication remain pending. Interactive browser rendering was unavailable during local implementation; automated accessibility and HTTP checks passed. Pre-existing deletion of docs/resolved-bugs-enhancements.md remains preserved.
```
