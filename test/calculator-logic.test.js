const test = require('node:test');
const assert = require('node:assert/strict');
const { appendValue } = require('../public/calculator-logic');

test('appendValue replaces the initial zero when a parenthesis is entered first', () => {
  assert.equal(appendValue('0', '('), '(');
});
