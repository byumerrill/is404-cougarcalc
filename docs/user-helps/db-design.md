# Release 2 database design

CougarCalc uses one PostgreSQL table:

| Column | PostgreSQL definition | Purpose |
| --- | --- | --- |
| `calculation_id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Unique database-generated identifier |
| `calculated_at` | `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP` | Time the calculation was saved |
| `expression` | `text NOT NULL` | Original valid arithmetic expression |
| `result` | `double precision NOT NULL` | Result matching JavaScript's numeric type |
| `browser_token_hash` | `text NOT NULL` with a lowercase SHA-256 format check | Hash that scopes every row to one anonymous browser |

Every calculation row must have a lowercase 64-character SHA-256 hash. PostgreSQL never stores the raw cookie token.

## Indexes

- `(browser_token_hash, calculated_at DESC, calculation_id DESC)` supports the Release 2 query: one browser's rows, newest first.

The browser hash is the leading index key because every `/history` query filters on it before ordering by timestamp and identifier. There is no unscoped application-history query, so the schema does not create a redundant global ordering index.

## Anonymous browser identity

The server generates 32 random bytes and encodes them as a base64url token. The raw token exists only in the browser's `cougarcalc_history` cookie and HTTP cookie headers. `browser-identity.js` hashes it with SHA-256 before calling repository methods.

This is browser-specific history rather than authentication:

- different browsers, profiles, private windows, and devices have different histories;
- clearing the cookie creates a new identity;
- the cookie normally lasts 365 days;
- the design uses no IP address, browser fingerprint, account, or personal identifier; and
- possession of the raw cookie token grants access to that anonymous history, which is why future HTTPS remains important.

## Data rules

- Only successful calculations are inserted.
- Every row has a non-null browser hash, expression, and result.
- The application rejects non-finite results before insertion.
- Browser hash, expression, and result values use parameterized SQL.
- `/history` requires a valid hash and filters with `WHERE browser_token_hash = $1`.
- Invalid requests and calculation errors are not history records.

## Database roles

The setup separates object ownership from application access:

- `cougarcalc_owner` is a `NOLOGIN` role that owns the database objects. An administrator uses `SET ROLE cougarcalc_owner` while applying migrations.
- `cougarcalc_app` is the restricted login used by Node.js. It receives schema `USAGE`, table `SELECT` and `INSERT`, and identity-sequence `USAGE`.
- The PostgreSQL administrator creates the roles and database but is never configured as the application login.

The additional hash column and index do not require broader app privileges.

## Migrations

Initialize a clean Release 2 database with the checked-in file as `cougarcalc_owner`:

```sql
\set ON_ERROR_STOP on
SET ROLE cougarcalc_owner;
\i database/migrations/001-create-calculation-history.sql
```

Migration `001` creates the complete Release 2 table, including anonymous browser ownership, the hash-format constraint, and the browser-scoped index. Release 1 had no database, so there is no earlier database schema to upgrade.

The file uses `IF NOT EXISTS` guards where PostgreSQL supports them. Those guards prevent duplicate-object errors; they do not repair an object with an incorrect definition. After Release 2 is deployed, future schema changes belong in migration `002` and later rather than editing the deployed `001` file.

See [initial_db_setup.md](initial_db_setup.md) for complete role, permission, platform, and verification instructions.

## Startup readiness check

Before listening for HTTP requests, `database.js` verifies:

- all five expected column names, types, and nullability;
- the exact validated lowercase SHA-256 format constraint on `browser_token_hash`;
- the `calculated_at` default;
- the `ALWAYS` identity and valid single-column primary key on `calculation_id`;
- the valid, ready, live browser-scoped B-tree index and its exact key order/direction; and
- schema `USAGE`, table `SELECT` and `INSERT`, and sequence `USAGE` for the connected role.

These are minimum privileges. Startup accepts a role with additional privileges, although the recommended app role remains least-privileged. A mismatch prevents startup with a safe database-readiness message.
