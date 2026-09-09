# CougarCalc initial PostgreSQL setup

This guide sets up PostgreSQL 17 for CougarCalc. It is written for a first-time PostgreSQL user and separates database administration from the account used by the running application.

It also explains the anonymous browser-history cookie retained in Release 03. No IP addresses, user accounts, or browser fingerprints are stored.

## What this setup creates

| Name | Type | Purpose |
| --- | --- | --- |
| `postgres` | PostgreSQL administrator login | Used only for initial administration and recovery. Never put this account in the app configuration. |
| `cougarcalc_owner` | `NOLOGIN` owner role | Owns the database objects and is assumed only while running DDL/migrations. It cannot connect directly. |
| `cougarcalc_app` | Restricted login role | Used by the Node.js app. It can read and add calculation history, but cannot create, alter, or drop tables. |
| `cougarcalc` | Database | Stores CougarCalc data. |

This is an application of least privilege: a mistake in the app, or disclosure of its password, does not also grant schema-administration rights.

The setup order matters:

1. Install and start PostgreSQL.
2. Create the owner role, app login, and database.
3. Run migration `001` as `cougarcalc_owner`.
4. Grant the app only its runtime permissions.
5. Configure the app, test it, and then start it normally.

Do not use a real password from this document. Generate a different password for every student and every environment, store it in a password manager, and enter it only when prompted.

## Before starting

- Work from the root of this repository when a command uses a relative path.
- Use the latest available **17.x** installer even if a newer major version is offered. PostgreSQL minor releases contain fixes rather than application-breaking feature changes; do not seek out an old 17.0 installer.
- Use Node.js 22.x, matching `package.json` and the selected Elastic Beanstalk platform branch.
- If PostgreSQL is already installed, do not install a second copy until you know which version, port, and data directory the existing server uses. Multiple local servers commonly compete for port `5432`.
- Back up any existing database with the same name before replacing or modifying it.

The official PostgreSQL download pages are the source of truth for currently supported installers:

- [Windows PostgreSQL downloads](https://www.postgresql.org/download/windows/)
- [macOS PostgreSQL downloads](https://www.postgresql.org/download/macosx/)
- [Ubuntu PostgreSQL downloads](https://www.postgresql.org/download/linux/ubuntu/)

Start at one of those `postgresql.org` pages instead of a search advertisement or third-party download site. The desktop installer is hosted by EDB after following the official link. Before running it, confirm that the filename says PostgreSQL 17 and matches the computer's architecture. On Windows, inspect the downloaded file's Properties > Digital Signatures and confirm the publisher is EnterpriseDB. On macOS, allow the normal Gatekeeper verification and do not bypass an unidentified-developer or damaged-package warning; download a fresh copy from the official link instead.

## Windows installation

1. From the official Windows download page, select the EDB interactive installer for PostgreSQL 17.
2. Keep these components selected:
   - PostgreSQL Server
   - Command Line Tools
   - pgAdmin 4
3. Stack Builder is not needed for CougarCalc.
4. Keep port `5432` unless it is already in use. If another port is selected, use that same value for `DATABASE_PORT` later.
5. Set a strong password for the `postgres` administrator and save it in a password manager. This is not the app password.
6. Complete the installation using the default locale unless the instructor specifies another one.

Open a new PowerShell window and verify the installation:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" --version
Get-Service -Name "postgresql*"
```

The reported client major version should be 17 and the PostgreSQL service should be `Running`.

To make the PostgreSQL commands available without their full path for the current PowerShell window:

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\17\bin"
psql --version
```

That PATH change lasts only for the current PowerShell window. Adding the same `bin` directory to the user's Windows `Path` setting makes it persistent.

## macOS installation

For a course with both Windows and macOS students, use the EDB interactive installer from the official macOS download page. It gives both groups the same server, `psql`, and pgAdmin tools. Homebrew and Postgres.app are valid alternatives, but their service behavior and default users differ from the Windows lab.

1. Download the EDB interactive installer for PostgreSQL 17 that matches the Mac processor (Apple silicon/arm64 or Intel/amd64).
2. Keep PostgreSQL Server, Command Line Tools, and pgAdmin 4 selected.
3. Stack Builder is not needed for CougarCalc.
4. Keep port `5432` unless it is already in use.
5. Set a strong password for the `postgres` administrator and save it in a password manager.
6. Complete the installation using the default locale unless the instructor specifies another one.

Open a new Terminal window and verify the installation:

```bash
/Library/PostgreSQL/17/bin/psql --version
/Library/PostgreSQL/17/bin/pg_isready -h localhost -p 5432
```

Add the command-line tools to the current Terminal session:

```bash
export PATH="/Library/PostgreSQL/17/bin:$PATH"
psql --version
```

To make that PATH setting persistent for the default zsh shell, add the `export` line to `~/.zprofile`, then open a new Terminal window. Do not add it a second time if it is already present.

## Create the local roles and database

The following `psql` steps are identical on Windows and macOS after `psql` is on `PATH`.

Connect to the maintenance database as the administrator:

```text
psql -X -h localhost -p 5432 -U postgres -d postgres -W
```

`-W` asks for the administrator password without placing it in shell history. A successful connection displays a `postgres=#` prompt. Enter the following commands one at a time:

```sql
\set ON_ERROR_STOP on

CREATE ROLE cougarcalc_owner
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION;

CREATE ROLE cougarcalc_app
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION;

\password cougarcalc_app

CREATE DATABASE cougarcalc OWNER cougarcalc_owner;
REVOKE CONNECT ON DATABASE cougarcalc FROM PUBLIC;
GRANT CONNECT ON DATABASE cougarcalc TO cougarcalc_app;
```

The `\password` command prompts twice and avoids putting the password in SQL or shell history. Do not reuse the `postgres` password.

If `CREATE ROLE` or `CREATE DATABASE` reports that the name already exists, stop instead of guessing. Determine whether this is a previous CougarCalc setup that should be kept, repaired, or removed. Removing a role or database can permanently delete data and is not part of this guide.

## Run the DDL migration and grant app permissions

DDL means data definition language: SQL that creates or changes database structures. Release 1 had no database, so Release 2 has one clean-install schema migration:

```text
database/migrations/001-create-calculation-history.sql
```

Migration `001` creates the complete calculation-history table, requires anonymous browser ownership on every row, constrains the hash format, and creates the browser-scoped newest-first index. Run it after the roles and database exist, but before starting the application. Do not run it as `cougarcalc_app`; the app account should never own or create tables.

While still in `psql`, connect to the new database, assume the owner role, and execute the repository's DDL files:

```sql
\connect cougarcalc
SET ROLE cougarcalc_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\i database/migrations/001-create-calculation-history.sql
```

The `\i` path is relative to the directory from which `psql` was started. If the file is not found, use its absolute path. In `psql` on Windows, forward slashes in a path are convenient, for example:

```text
\i C:/Users/student/github-projects/cougarcalc/database/migrations/001-create-calculation-history.sql
```

Grant only the permissions used by the current application:

```sql
GRANT USAGE ON SCHEMA public TO cougarcalc_app;
GRANT SELECT, INSERT ON TABLE public.calculation_history TO cougarcalc_app;
GRANT USAGE ON SEQUENCE public.calculation_history_calculation_id_seq TO cougarcalc_app;

ALTER DEFAULT PRIVILEGES FOR ROLE cougarcalc_owner IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO cougarcalc_app;

ALTER DEFAULT PRIVILEGES FOR ROLE cougarcalc_owner IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO cougarcalc_app;

RESET ROLE;
```

The default privileges apply only to future objects created by `cougarcalc_owner`. This is another reason to run every future migration as that role. If a later application feature needs `UPDATE` or `DELETE`, grant it deliberately at that time rather than granting it now.

Inspect the result:

```sql
\dt+ public.*
\di+ public.calculation_history*
\dp public.calculation_history
\dp public.calculation_history_calculation_id_seq

SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
FROM pg_roles
WHERE rolname IN ('cougarcalc_owner', 'cougarcalc_app')
ORDER BY rolname;

\quit
```

Expected role characteristics:

- `cougarcalc_owner`: `rolcanlogin` is false and all elevated attributes are false.
- `cougarcalc_app`: `rolcanlogin` is true and all elevated attributes are false.

## Verify the restricted app login

Connect as the app account:

```text
psql -X -h localhost -p 5432 -U cougarcalc_app -d cougarcalc -W
```

Check the identity and privileges without changing data:

```sql
SELECT current_user, current_database();

SELECT
  has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
  has_table_privilege(current_user, 'public.calculation_history', 'SELECT') AS can_select,
  has_table_privilege(current_user, 'public.calculation_history', 'INSERT') AS can_insert,
  has_table_privilege(current_user, 'public.calculation_history', 'UPDATE') AS can_update,
  has_table_privilege(current_user, 'public.calculation_history', 'DELETE') AS can_delete,
  has_sequence_privilege(
    current_user,
    'public.calculation_history_calculation_id_seq',
    'USAGE'
  ) AS can_use_identity_sequence;

SELECT * FROM public.calculation_history LIMIT 1;
\quit
```

`can_use_schema`, `can_select`, `can_insert`, and `can_use_identity_sequence` should be true. `can_update` and `can_delete` should be false in this least-privilege setup.

When database configuration is complete, CougarCalc runs `checkReadiness()` before opening the HTTP listener. That check first verifies the connection and then uses `verifySchema()` to inspect:

- the exact five column names, data types, and non-null requirements, including `browser_token_hash`;
- the validated lowercase 64-character SHA-256 check constraint on `browser_token_hash`;
- the timestamp default;
- the `ALWAYS` identity and single-column primary key on `calculation_id`;
- the valid, ready, live B-tree index on `browser_token_hash, calculated_at DESC, calculation_id DESC`; and
- schema `USAGE`, table `SELECT` and `INSERT`, and identity-sequence `USAGE` for the connected role.

These are minimum required privileges. Startup does not fail merely because the connected role has additional privileges, although the recommended `cougarcalc_app` setup grants only what the current application needs.

If a check fails, Express still starts in degraded mode. The public readiness response remains only `not ready`; safe server logs identify the fixed stage (`connection`, `schema_columns`, `schema_constraint`, `schema_primary_key`, `schema_index`, or `runtime_privileges`) without exposing connection or user data.

## Configure the local `.env` file

CougarCalc loads `.env` from the repository root using Node's `process.loadEnvFile()`. Copy the committed example rather than editing it directly.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS Terminal:

```bash
cp .env.example .env
```

Edit `.env` locally:

```dotenv
HOST=127.0.0.1
PORT=3000
NODE_ENV=development
HISTORY_COOKIE_SECURE=false

DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=cougarcalc
DATABASE_USER=cougarcalc_app
DATABASE_PASSWORD="replace-with-the-cougarcalc-app-password"
DATABASE_TLS_MODE=disable
```

Quotes are useful when a value contains spaces or `#`; the quote characters are not part of the value. Keep the password on one line. Do not add spaces to the variable names.

For local HTTP and the initial HTTP-only Beanstalk validation, keep `HISTORY_COOKIE_SECURE=false`. The browser still receives an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie with a 365-day lifetime. During the Release 03 AWS HTTPS transition, change this setting to `true` only after the custom hostname, load-balancer certificate, HTTPS listener, and redirect work. If it is `true` while using HTTP, browsers will not return the cookie and every request can appear to have a new empty history.

The repository's `.gitignore` already excludes `.env` and `.env.*` while allowing `.env.example`. Verify that Git ignores the populated file:

```text
git check-ignore -v .env
git status --short
```

`.env` must not appear as an untracked or staged file. Never commit it, attach it to an assignment submission, paste it into chat, or use the same password in another environment. `.env.example` must contain placeholders only.

If a secret is accidentally committed, removing the file from the latest commit is not sufficient: rotate the database password immediately and follow the course procedure for cleaning Git history.

## Test the local application

Install Node dependencies and run the automated tests:

```text
npm ci
npm test
```

The automated tests do not require a real database. Then run the real database smoke check:

```text
node debug-check.js
```

The smoke check starts the app on a temporary local port, retains one anonymous cookie internally, inserts a calculation, retrieves that browser's history, and closes the server and connection pool. It prints only readiness, save status, history count, and the short instance marker—not the expression, result, cookie, token/hash, database configuration, or raw error. See [release-validation.md](release-validation.md) for every validation check and its prerequisites. Finally, start the app normally:

```text
npm start
```

Open <http://localhost:3000>, perform a calculation, and confirm that it appears in history. Stop and restart the app and confirm that the history remains. That restart is the evidence that the data is in PostgreSQL rather than only in Node memory.

Then open the app in a second browser. Its history should initially be empty. Calculations made there must not appear in the first browser. Chrome, Edge, private windows, browser profiles, and other devices each receive separate identities. Clearing the `cougarcalc_history` cookie starts a new empty history and does not delete the inaccessible rows associated with the old cookie.

## Using pgAdmin

pgAdmin is useful for learning and inspection. The EDB installer normally makes the local PostgreSQL server available in pgAdmin; if it does not, register a server using host `localhost`, port `5432`, maintenance database `postgres`, and username `postgres`.

Recommended uses in this lab:

- Expand Databases > cougarcalc > Schemas > public > Tables to inspect the table.
- Open View/Edit Data to see saved calculations.
- Use Query Tool for short exploratory `SELECT` statements.

Use the checked-in `.sql` file through `psql` for repeatable DDL. A GUI query window makes it easier to run only part of a migration accidentally and harder to reproduce the exact steps later.

## Ubuntu VM: staging or self-hosted deployment

Do not reuse local credentials. Create new `cougarcalc_owner` and `cougarcalc_app` roles on the VM and generate a new app password.

### Install PostgreSQL 17

Ubuntu's built-in repository may contain a different PostgreSQL major version. To pin the course environment to 17, use the official PostgreSQL Apt repository:

```bash
sudo apt update
sudo apt install -y postgresql-common ca-certificates
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt update
sudo apt install -y postgresql-17 postgresql-client-17
sudo systemctl enable --now postgresql
sudo systemctl status --no-pager postgresql
psql --version
```

Review the repository-configuration script before approving it in a production organization. Package updates from this repository provide supported PostgreSQL minor releases; apply and test security updates regularly.

### Create roles, database, and schema

Open an administrative `psql` session using Ubuntu's local PostgreSQL system account:

```bash
sudo -u postgres psql -X -d postgres
```

Use the same SQL from **Create the local roles and database**. Then connect to `cougarcalc`, run migration `001` as `cougarcalc_owner`, and apply the grants from **Run the DDL migration and grant app permissions**. Use an absolute path with `\i` and ensure the `postgres` operating-system account can read the file.

Keep PostgreSQL listening only where it is needed. When Node and PostgreSQL run on the same VM, use `DATABASE_HOST=localhost` and do not open TCP port `5432` in the cloud firewall/security group or UFW.

### Store runtime configuration outside the repository

Do not deploy the development `.env`. For a systemd-managed Node service, place the variables in a root-controlled file such as `/etc/cougarcalc/cougarcalc.env`, set its ownership to `root:root`, and set its mode to `600`. Reference it from the service with:

```ini
[Service]
EnvironmentFile=/etc/cougarcalc/cougarcalc.env
```

The environment file should contain the same `DATABASE_*` names expected by the app, a deployment-specific password, and `HISTORY_COOKIE_SECURE=false` while the Ubuntu site uses HTTP. After changing it, run the normal systemd daemon-reload and service-restart procedure. Do not print the environment file or browser cookies in logs or troubleshooting screenshots.

Before a production migration:

1. Take and verify a database backup or snapshot.
2. Test the migration against staging and a recent sanitized copy of the schema.
3. Stop writes or use a backwards-compatible migration when required.
4. Run the migration once as the owner/migration identity, never as the app identity.
5. Verify the schema and permissions.
6. Deploy the application version that depends on the new schema.
7. Monitor application and PostgreSQL logs and have a tested rollback plan.

Migration `001` initializes a clean Release 2 database and uses repeatable guards where PostgreSQL supports them. These guards do not make every future schema change safe or reversible, and they do not repair objects with incorrect definitions.

## AWS Elastic Beanstalk with Aurora/RDS for PostgreSQL

The current instructor architecture uses an Aurora Serverless v2 PostgreSQL-compatible database managed separately from the Elastic Beanstalk environment. Separating the database lifecycle allows it to survive rebuilding or terminating the application environment. The application also works with a separately managed RDS for PostgreSQL instance when the same schema, role, network, and verified-TLS contract is used. AWS documents the separation pattern in [Using Elastic Beanstalk with Amazon RDS](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/AWSHowTo.RDS.html) and the wake-up behavior in [Scaling to Zero ACUs with automatic pause and resume](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html).

Release 03 requirements:

- Keep RDS and the Beanstalk instances on an explicitly reviewed network path.
- Decide public versus private RDS access during the guided infrastructure walkthrough; do not guess it in application setup.
- Allow inbound PostgreSQL traffic on port `5432` only through the narrow course-approved security-group relationship, never from `0.0.0.0/0`.
- Enable storage encryption, automated backups, deletion protection, and an appropriate retention period.
- Use a separate database and separate credentials for staging and production.
- Treat the RDS primary/master login as an administrator, not as the app login.
- Create the owner/app roles, run the DDL as the owner, and grant runtime permissions using the same model as local setup.
- Run migrations from a controlled host or job that can reach the private RDS endpoint. Do not make application startup silently apply DDL.

For the first managed course deployment, set the application configuration through Beanstalk environment properties:

```text
DATABASE_HOST=<the RDS endpoint, without https://>
DATABASE_PORT=5432
DATABASE_NAME=cougarcalc
DATABASE_USER=cougarcalc_app
DATABASE_TLS_MODE=verify-full
DATABASE_CA_PATH=database/certs/global-bundle.pem
NODE_ENV=production
HISTORY_COOKIE_SECURE=false
```

Keep `HISTORY_COOKIE_SECURE=false` for initial HTTP validation. Change it to `true` only after users reach Beanstalk through the custom HTTPS hostname. This browser-cookie setting is separate from PostgreSQL TLS.

Configure `DATABASE_PASSWORD` as a secret-backed Elastic Beanstalk environment variable. If Secrets Manager stores a JSON credential object, select its top-level `password` field (for example, with Elastic Beanstalk's supported `:password` JSON-key suffix). CougarCalc expects one scalar password and rejects a parseable JSON object before pool creation as `database_password_is_structured_value`.

Never place the password, complete secret, or secret ARN in Git, the source bundle, screenshots, tests, documentation examples, or logs. Grant the Beanstalk instance profile only the permission required to retrieve the intended secret, and follow AWS's current [Elastic Beanstalk secrets and parameters documentation](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/AWSHowTo.secrets.env-vars.html). Do not upload `.env` in the application bundle.

Elastic Beanstalk resolves the secret during instance bootstrapping. After rotating the secret, use an approved environment update or application-server restart to refresh existing instances. During a scaled rollout, old and new credentials may need to overlap until every target has refreshed.

### Verified TLS support

Release 03 [`database.js`](../../database.js) implements explicit TLS modes:

1. `DATABASE_TLS_MODE=disable` provides intentional local non-TLS.
2. `DATABASE_TLS_MODE=verify-full` loads the PEM file named by `DATABASE_CA_PATH`.
3. Verified mode requires a DNS hostname and `rejectUnauthorized: true`, so Node validates both the Amazon CA chain and endpoint hostname.
4. A raw IP, missing/unreadable CA, malformed CA, or unsupported mode starts safely degraded.
5. Connection, query, and public readiness ceilings are 35, 10, and 10 seconds. The longer connection allowance supports Aurora resume while keeping each public readiness response bounded.

`node-postgres` accepts an `ssl` object in its client/pool configuration; see its [SSL documentation](https://node-postgres.com/features/ssl). AWS explains certificate download, verification, and `rds.force_ssl` in [Using SSL with a PostgreSQL DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html).

Verify the RDS connection with certificate validation and confirm on the database side that SSL is in use. The checked-in `database/certs/global-bundle.pem` is Amazon's public trust bundle, not a secret. Compare it with the official AWS trust-store source during certificate rotations and before a release; review, test, rebuild, and deploy updates before affected server certificates expire.

## Future migrations

Add each schema change as a new, numbered file rather than editing `001` after it has been deployed, for example:

```text
database/migrations/002-descriptive-name.sql
```

Apply migrations in numeric order as `cougarcalc_owner`. The restricted `cougarcalc_app` account should never receive `CREATE`, `ALTER`, `DROP`, database ownership, schema ownership, `CREATEROLE`, `CREATEDB`, or superuser access.

For a classroom exercise, an instructor may run migrations manually with `psql`. A later production-oriented release should adopt a migration tool that records which migrations have run and coordinates concurrent deployments.

## Troubleshooting

### `psql` is not recognized

Open a new terminal after installation. On Windows, use `C:\Program Files\PostgreSQL\17\bin\psql.exe` or add that directory to `Path`. On macOS with the EDB installer, use `/Library/PostgreSQL/17/bin/psql` or add that directory to `PATH`.

### Connection refused

Confirm that the server is running and that the configured port matches the installer selection. Use `pg_isready -h localhost -p 5432`. A refusal happens before password checking.

### Password authentication failed

Confirm the username, database, port, and which password is being entered. The safe application log category is `authentication_failed` with PostgreSQL code `28P01`; it is not retryable with unchanged credentials. The `postgres` administrator and `cougarcalc_app` should have different passwords. Reset the app password from an authorized administrator session with `\password cougarcalc_app`, then update the local or deployment secret.

If the category is `database_password_is_structured_value`, do not reset the database password. Correct the Elastic Beanstalk secret-backed variable so it extracts the JSON secret's top-level `password` field instead of injecting the complete object.

### Database or role already exists

Do not delete it automatically. Inspect it first. It may contain work from an earlier lab attempt. Ask the instructor before dropping a database or role.

### Permission denied for the table or sequence

Connect as the administrator, `SET ROLE cougarcalc_owner`, and reapply the explicit table and sequence grants. Confirm that the migration objects are owned by `cougarcalc_owner`; default privileges do not apply to objects created by a different role.

### Readiness says PostgreSQL is not ready

Use the safe `readiness_failed` stage before changing infrastructure. `connection` points to configuration, DNS, networking, TLS, authentication, database name, or Aurora wake-up. The four `schema_*` stages point to migration/schema drift. `runtime_privileges` points to schema, table, or sequence grants.

For schema failures, confirm that `public.calculation_history` exists in the database named by `DATABASE_NAME` and matches the required non-null columns, identity/primary-key configuration, constraint, and browser-scoped history index. For a clean Release 2 database, rerun migration `001` as `cougarcalc_owner` with `ON_ERROR_STOP` enabled, address the first error, and then verify the grants. `IF NOT EXISTS` does not convert an older or incompatible table into the expected schema; recreate a disposable development database or write a deliberate future migration instead.

### Browser history is always empty

Confirm `HISTORY_COOKIE_SECURE=false` while using HTTP and check that the browser retains the `cougarcalc_history` cookie. A different browser, profile, private window, cleared cookie, or API request without a cookie correctly receives a separate empty history.

### RDS times out

A timeout can mean Aurora is waking from auto-pause or that the network path is blocked. A readiness request returns after at most 10 seconds while the shared connection attempt can continue for up to 35 seconds. Poll readiness at a reasonable interval and look for one `readiness_recovered` event. If it does not recover, check Aurora/RDS availability, VPC routes, DNS, and the security-group rule from the Beanstalk instance security group. Do not make the database public as a shortcut.

### RDS reports an SSL error

Do not disable certificate verification. Confirm `DATABASE_TLS_MODE=verify-full`, the current AWS RDS CA bundle path, the exact RDS endpoint hostname rather than an IP address, and the intended Beanstalk environment properties.
