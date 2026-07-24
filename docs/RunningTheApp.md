# Running CougarCalc

CougarCalc is a calculator application built with Node.js, Express, HTML, CSS, and JavaScript.

## First-time setup

1. Open a terminal such as Git Bash or PowerShell.
2. Change to the folder where you cloned CougarCalc.
3. Confirm that Node.js and npm are installed:

   ```bash
   node -v
   npm -v
   ```

4. If necessary, install Node.js from <https://nodejs.org/> and reopen the terminal.
5. Install the project dependencies:

   ```bash
   npm install
   ```

6. Start the app:

   ```bash
   npm start
   ```

The console should show output similar to:

```text
CougarCalc listening on all IPv4 network interfaces (0.0.0.0) on port 3000
On this computer, use http://localhost:3000
From another device, use http://<this-computer-ip>:3000
```

`0.0.0.0` means the server listens on all available IPv4 network interfaces. It is a listening address, not the address you normally enter in a browser.

## Opening the app

From the computer running CougarCalc, open:

```text
http://localhost:3000
```

From another device on the same network, replace `<this-computer-ip>` with the server computer's local network address:

```text
http://<this-computer-ip>:3000
```

Firewall and network settings may prevent access from other devices. Listening on `0.0.0.0` does not automatically expose the app to the public internet.

## Using the calculator

1. Build an expression with the calculator buttons or keyboard, such as `2 + 3 * 4`.
2. Press the `=` button or the Enter key.
3. The answer appears in the result display.
4. Successful calculations appear in the page's recent history.

The C button clears the expression. Backspace removes the last character. Escape or Delete also clears the expression when the calculator display has keyboard focus.

## Testing the API from PowerShell

Make sure the app is running, then use:

```powershell
$body = @{
  expression = "2 + 3 * 4"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:3000/calculate" `
  -ContentType "application/json" `
  -Body $body
```

The response should contain:

```text
result
------
    14
```

## Testing the API with curl

From Git Bash:

```bash
curl -X POST "http://localhost:3000/calculate" \
  -H "Content-Type: application/json" \
  -d '{"expression":"2 + 3 * 4"}'
```

Expected JSON response:

```json
{"result":14}
```

Add `-i` to include HTTP response headers:

```bash
curl -i -X POST "http://localhost:3000/calculate" \
  -H "Content-Type: application/json" \
  -d '{"expression":"2 + 3 * 4"}'
```

Exact generated headers such as `Date`, `ETag`, and `Content-Length` can vary.

## Error responses

Invalid requests return HTTP status `400` and a JSON error. Examples include:

- an empty or malformed expression;
- unsupported characters;
- division by zero;
- a non-finite result; and
- malformed JSON.

For example:

```bash
curl -i -X POST "http://localhost:3000/calculate" \
  -H "Content-Type: application/json" \
  -d '{"expression":"1 / 0"}'
```

## Running automated tests

Run the complete suite with:

```bash
npm test
```

The project uses Node.js's built-in test runner; no separate test framework is required.

- `test/app.test.js` covers HTTP routes, calculations, validation, JSON errors, environment labels, and `404` responses.
- `test/calculator-logic.test.js` covers browser-side input construction and result formatting.

## Running the debug check

The included diagnostic script starts the app on a temporary port, submits `1.001 - 1`, prints the response, and closes the server:

```bash
node debug-check.js
```

## Testing with Bruno

Bruno is an optional API client. Download it from <https://www.usebruno.com/downloads/> or install it on Windows with:

```powershell
winget install --id Bruno.Bruno -e
```

To create a calculation request:

1. Open or create a Bruno collection.
2. Create a request named `Calculate Expression`.
3. Set the method to `POST`.
4. Set the URL to `http://localhost:3000/calculate`.
5. Set `Content-Type` to `application/json`.
6. Use this JSON body:

   ```json
   {
     "expression": "2 + 3 * 4"
   }
   ```

7. Send the request and confirm the result is `14`.

The repository's `bruno/CougarCalcCollection/` folder contains the current collection metadata.

## Troubleshooting

- If `node` or `npm` is not recognized, install Node.js and reopen the terminal.
- If the page does not open, confirm that `npm start` is still running and use `http://localhost:3000`.
- If port 3000 is already in use, set a different `PORT` environment variable before starting the app.
- If another device cannot connect, confirm the local IP address and check the server computer's firewall.
- If the logo does not appear, confirm that `cougar-icon-v2.png` exists in the project root.
