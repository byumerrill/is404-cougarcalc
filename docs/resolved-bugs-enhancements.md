# Resolved Enhancements and Bugs

The following items have been implemented and are now complete.

## RESOLVED: Remove collection of request metadata

- Removed the optional nickname field from the calculator UI and request payload.
- Removed collection of local and remote IP addresses and ports.
- Removed the CSV request log and all associated server logic.

## RESOLVED: Hosting environment label

- Added a visible badge in the app UI showing whether the app is running in development or production.
- The environment label is fetched dynamically from the server.

## RESOLVED: Parenthesis-first calculator bug

- Fixed the input logic so typing "(" first replaces the initial zero instead of producing "0(".
- The calculator now evaluates expressions correctly after that input pattern.

## RESOLVED: Decimal entry across multiple operands

- Changed decimal suppression to inspect only the number currently being entered.
- Button entry now permits expressions such as `1.5+2.5` while still rejecting a second decimal point in one operand.
- Added table-driven tests for input normalization, decimal handling, operators, parentheses, rounding, and non-finite values.

## RESOLVED: Isolate persistent history by anonymous browser

- Added a server-generated 32-byte anonymous history token stored in a protected browser cookie.
- Stored only the token's SHA-256 hash in PostgreSQL; no IP address or browser fingerprint is collected.
- Scoped calculation inserts and history retrieval to the current browser hash.
- Included browser ownership, its hash constraint, and its scoped index directly in the clean Release 2 database initialization.
- Added automated cookie, isolation, migration, SQL-safety, and readiness tests.
