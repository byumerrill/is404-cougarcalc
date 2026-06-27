# Resolved Enhancements and Bugs

The following items have been implemented and are now complete.

## RESOLVED: CSV request logging
- Added log directory ignore rules in the repository gitignore.
- Created a CSV log file for app requests.
- Captured request timestamp, local and remote addresses, ports, nickname, and submitted expression.
- The app writes to the log in append mode.

## RESOLVED: Hosting environment label
- Added a visible badge in the app UI showing whether the app is running in development or production.
- The environment label is fetched dynamically from the server.

## RESOLVED: Parenthesis-first calculator bug
- Fixed the input logic so typing "(" first replaces the initial zero instead of producing "0(".
- The calculator now evaluates expressions correctly after that input pattern.
