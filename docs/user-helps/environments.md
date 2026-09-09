# CougarCalc environments

Release 2 keeps the Release 1 deployment model: Node.js runs the Express application directly, and PostgreSQL runs separately as its own service. History is isolated by an anonymous browser cookie; there are no user accounts or IP-address records.

Only environment variables differ between deployments. Application code and SQL do not.

## Required database variables

```text
DATABASE_HOST
DATABASE_PORT
DATABASE_NAME
DATABASE_USER
DATABASE_PASSWORD
```

Optional application settings are `HOST`, `PORT`, `NODE_ENV`, and `HISTORY_COOKIE_SECURE`.

`HISTORY_COOKIE_SECURE` accepts only `true` or `false`:

- Use `false` when the browser reaches CougarCalc over HTTP.
- Use `true` only when the browser reaches CougarCalc over HTTPS.
- A browser will not return a `Secure` cookie over ordinary HTTP.

## Local development

Install Node.js and PostgreSQL 17. Create the owner and app roles, apply migration `001`, copy `.env.example` to `.env`, and use `npm start`.

Typical non-secret values are:

```text
HOST=127.0.0.1
PORT=3000
NODE_ENV=development
HISTORY_COOKIE_SECURE=false
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=cougarcalc
DATABASE_USER=cougarcalc_app
```

Supply the actual app password only through the ignored `.env` file or terminal environment. Create database objects as `cougarcalc_owner`; do not run DDL as `cougarcalc_app` or configure the app with an administrator login.

Each browser profile receives a different `cougarcalc_history` cookie. Chrome, Edge, a private window, and a second device therefore begin with separate histories.

## Ubuntu HTTP service

Install PostgreSQL as a Linux service independently from CougarCalc. Create deployment-specific roles, initialize the database as `cougarcalc_owner`, grant minimum runtime privileges to `cougarcalc_app`, and provide the application settings through the systemd service environment.

Use:

```text
NODE_ENV=production
HISTORY_COOKIE_SECURE=false
DATABASE_HOST=localhost
```

`NODE_ENV=production` does not automatically mark the cookie `Secure`; the explicit cookie setting prevents breaking an intentional HTTP deployment. Do not reuse local passwords on the VM.

Start and enable PostgreSQL with:

```bash
sudo systemctl enable --now postgresql
sudo systemctl status --no-pager postgresql
```

Use `HOST=0.0.0.0` only when the application should listen on all IPv4 interfaces. Firewall and host access rules remain deployment responsibilities. Do not expose PostgreSQL port `5432` when Node and PostgreSQL communicate over localhost.

## Future HTTPS environment

After HTTPS is deployed, set:

```text
HISTORY_COOKIE_SECURE=true
```

The application then adds the `Secure` attribute to the cookie. This protects browser-cookie transport but is separate from PostgreSQL TLS configuration.

## Verification

In every environment:

1. Create separate `cougarcalc_owner` and `cougarcalc_app` roles.
2. Run migration `001` as `cougarcalc_owner`.
3. Grant `cougarcalc_app` schema `USAGE`, table `SELECT` and `INSERT`, and identity-sequence `USAGE`.
4. Confirm `npm ci` and `npm test`.
5. Start CougarCalc and verify readiness passes for all five non-null columns, the validated browser-hash constraint, scoped index, identity, primary key, and minimum privileges.
6. Submit at least two calculations in one browser.
7. Confirm `GET /history` returns only that browser's calculations newest first.
8. Open another browser and confirm its history is empty; add a different calculation there.
9. Restart Node and confirm both browser histories remain separate and persistent.
10. Clear one browser's cookie and confirm only that browser receives a new empty history.

Additional database privileges do not cause startup failure, but the recommended app role should remain least-privileged. See [initial_db_setup.md](initial_db_setup.md) for complete commands.

Containers, cloud services, reverse proxies, HTTPS termination, authentication, and CI/CD remain outside this Release 2 implementation.
