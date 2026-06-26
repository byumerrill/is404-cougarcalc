CougarCalc is a simple demo calculator app built with Node.js, Express, and JavaScript.

How to run the app on your computer
-----------------------------------

If this is your first time setting everything up
------------------------------------------------
1. Open Git Bash.
2. Go to the project folder:
   cd /c/vscode-projects/cougarcalc
3. Check whether Node.js and npm are installed:
   node -v
   npm -v
   If you see version numbers, Node.js is ready.
4. If needed, install Node.js from https://nodejs.org/ and then reopen Git Bash.
5. Install the app's dependencies:
   npm install
6. Start the app:
   npm start
7. Open your browser and go to:
   http://localhost:3000

If you already set everything up
--------------------------------
1. Open Git Bash.
2. Go to the project folder:
   cd /c/vscode-projects/cougarcalc
3. Start the app:
   npm start
4. Open your browser and go to:
   http://localhost:3000

How to test the app
-------------------
1. Open the calculator page in your browser.
2. Enter two numbers.
3. Choose an operation (+, -, *, /).
4. Click "Calculate".
5. You should see the result appear on the screen.

How to run the automated test
------------------------------
1. In Git Bash, make sure you are still in the project folder.
2. Run:
   npm test
3. If everything is working, the test should pass.

How to add or update tests
--------------------------
1. Open the test file:
   test/app.test.js
2. Add a new test block for the behavior you want to protect.
3. Save the file.
4. Run:
   npm test
5. If the new test fails, update the app code and run the tests again until they pass.

Good examples of new tests
--------------------------
- divide by zero
- multiplication
- clear button behavior
- decimal arithmetic

If you have trouble
-------------------
- If "node" or "npm" is not recognized, close and reopen Git Bash and try again.
- If the app does not open, make sure you ran "npm start" first.
- If the logo does not show, make sure the image file named CougarCalc.png is still in the project folder.