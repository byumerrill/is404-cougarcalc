# Resolved Enhancements and Bugs

The following items have been implemented and are now complete.

## RESOLVED: Hosting environment label
- Added a visible badge in the app UI showing whether the app is running in development or production.
- The environment label is fetched dynamically from the server.

## RESOLVED: Parenthesis-first calculator bug
- Fixed the input logic so typing "(" first replaces the initial zero instead of producing "0(".
- The calculator now evaluates expressions correctly after that input pattern.

## RESOLVED: Decimal entry across operands
- Decimal points are checked against the current operand instead of the entire expression.
- Expressions such as `1.2 + 3.4` can now be entered correctly.

## RESOLVED: Calculation request validation
- Invalid expression characters are rejected instead of being silently removed.
- Empty, malformed, unsupported, and non-finite calculations return clear client errors.
- Malformed JSON now returns a structured JSON error response.

## RESOLVED: Expanded automated coverage
- Added server tests for calculation branches, validation errors, malformed JSON, routes, and environment labels.
- Added frontend-logic tests for zeroes, decimal entry, expression building, rounding, and non-finite results.

## RESOLVED: Removed optional data collection
- Removed CSV request logging and its related address-handling code.
- Removed the optional nickname field from the UI and calculation request payloads.
