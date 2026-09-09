# CougarCalc environments

Release 03 uses the same source bundle in every environment. Only environment properties differ. Node.js 22 runs the Express app, and PostgreSQL remains a separate service.

## Application settings

```text
HOST
PORT
NODE_ENV
HISTORY_COOKIE_SECURE
```

`HOST` defaults to `0.0.0.0`, `PORT` defaults to `3000`, and `NODE_ENV` defaults to `development`. `HISTORY_COOKIE_SECURE` defaults to `false` and, when supplied, accepts only exact `true` or `false`.

## Database settings

```text
DATABASE_HOST
DATABASE_PORT
DATABASE_NAME
DATABASE_USER
DATABASE_PASSWORD
DATABASE_TLS_MODE
DATABASE_CA_PATH
```

History is configured only when all first five connection values are nonblank. Missing or partial settings start degraded. `DATABASE_TLS_MODE` is still required when the connection values are complete:

- `disable` means explicit local non-TLS and requires `DATABASE_CA_PATH` to be absent.
- `verify-full` means verified TLS, requires a DNS hostname, and requires `DATABASE_CA_PATH` to point to a public PEM CA bundle.

`DATABASE_PASSWORD` must resolve to one scalar password. A parseable JSON object is treated as configuration misuse and rejected before a pool is created. Connection attempts are allowed up to 35 seconds for Aurora wake-up, queries up to 10 seconds, and public readiness requests up to 10 seconds.

## Local PostgreSQL

```text
HOST=127.0.0.1
PORT=3000
NODE_ENV=development
HISTORY_COOKIE_SECURE=false
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=cougarcalc
DATABASE_USER=cougarcalc_app
DATABASE_PASSWORD=local-only-value
DATABASE_TLS_MODE=disable
```

Keep the password only in ignored `.env` or the terminal environment. Create objects as `cougarcalc_owner`; do not give the Node application an administrator or owner login.

## AWS degraded validation

Initially omit every database property and use:

```text
NODE_ENV=production
HISTORY_COOKIE_SECURE=false
```

Beanstalk supplies `PORT`, and the application listens on all IPv4 interfaces by default. Use `/health/live` for the initial Beanstalk health path. Calculator results work but explicitly report `saved: false`.

## AWS with Aurora/RDS for PostgreSQL

After migration and network access are ready:

```text
NODE_ENV=production
HISTORY_COOKIE_SECURE=false
DATABASE_HOST=the-rds-dns-endpoint
DATABASE_PORT=5432
DATABASE_NAME=cougarcalc
DATABASE_USER=cougarcalc_app
DATABASE_TLS_MODE=verify-full
DATABASE_CA_PATH=database/certs/global-bundle.pem
```

Configure `DATABASE_PASSWORD` as a secret-backed Elastic Beanstalk environment variable. When the Secrets Manager value is a JSON credential object, select its top-level `password` field (for example, with the supported `:password` JSON-key suffix). Do not inject the complete JSON secret. It will be rejected as `database_password_is_structured_value`, and neither the JSON nor its embedded password will be logged.

The password and secret ARN/value must not enter Git, the ZIP, screenshots, fixtures, documentation examples, or logs. The Beanstalk instance profile must have only the permission needed to retrieve the intended secret. Follow AWS's current [Elastic Beanstalk secrets and parameters guidance](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/AWSHowTo.secrets.env-vars.html).

Beanstalk fetches secret values when instances bootstrap. A Secrets Manager rotation does not automatically refresh every existing instance; deliberately update or restart the environment and allow for a temporary mix of old/new values during scaling.

The public RDS CA bundle is not a secret. Review it against Amazon's current trust-store copy during certificate rotation and before a new release.

Once `/health/ready` returns `200` and browser history persists, switch the Beanstalk health path to readiness.

## AWS after HTTPS

After the custom hostname, ACM certificate, HTTPS listener, and redirect are all verified, change:

```text
HISTORY_COOKIE_SECURE=true
```

This changes the anonymous browser cookie. It is independent of RDS TLS, which remains `DATABASE_TLS_MODE=verify-full`.

## Verification in every ready environment

1. Apply migration `001` as `cougarcalc_owner`, never through web startup.
2. Grant `cougarcalc_app` schema `USAGE`, table `SELECT` and `INSERT`, and sequence `USAGE`.
3. Confirm liveness `200` and readiness `200`.
4. Save two calculations in one browser and confirm newest-first history.
5. Confirm another browser receives separate history.
6. Restart Node and confirm both browser histories persist.
7. Stop or block PostgreSQL and confirm prompt readiness/history failure plus successful unsaved calculations.
8. Restore PostgreSQL and confirm readiness and new saves recover.

Public failures remain generic. Logs may identify safe configuration characteristics, missing variable names, readiness stages, fixed operation names, classified categories, bounded codes, retryability, elapsed time, state transitions, and the short instance marker. They never contain database hostnames or usernames, passwords, secret ARNs/values, connection strings, calculation expressions, request bodies, cookies, browser tokens/hashes, SQL text, stack traces, raw errors, CA contents, or the complete environment.

See [release-validation.md](release-validation.md) for the check matrix and the required local, bundle, browser, and AWS validation evidence.
