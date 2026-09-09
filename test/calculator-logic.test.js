const test = require('node:test');
const assert = require('node:assert/strict');
const {
  appendValue,
  formatResult,
  beginNextExpression
} = require('../public/calculator-logic');

test('appendValue replaces the initial zero with a digit or opening parenthesis', () => {
  assert.equal(appendValue('0', '7'), '7');
  assert.equal(appendValue('0', '('), '(');
});

test('appendValue handles decimal entry', () => {
  assert.equal(appendValue('0', '.'), '0.');
  assert.equal(appendValue('1.2', '.'), '1.2');
});

test('appendValue permits decimals in separate operands', () => {
  assert.equal(appendValue('1.2+3', '.'), '1.2+3.');
  assert.equal(appendValue('1.2+3.', '.'), '1.2+3.');
});

test('appendValue handles the double-zero button', () => {
  assert.equal(appendValue('0', '00'), '0');
  assert.equal(appendValue('5', '00'), '500');
  assert.equal(appendValue('5+', '00'), '5+0');
});

test('appendValue defaults an invalid current formula to zero', () => {
  assert.equal(appendValue(undefined, '7'), '7');
});

test('formatResult rounds floating-point noise', () => {
  assert.equal(formatResult(0.1 + 0.2), '0.3');
  assert.equal(formatResult(1.00000000001), '1');
});

test('formatResult returns Error for non-finite values', () => {
  assert.equal(formatResult(Infinity), 'Error');
  assert.equal(formatResult(Number.NaN), 'Error');
});

test('beginNextExpression starts a new expression for digits, decimals, and parentheses', () => {
  assert.equal(beginNextExpression('5', '7'), '7');
  assert.equal(beginNextExpression('5', '.'), '0.');
  assert.equal(beginNextExpression('5', '('), '(');
  assert.equal(beginNextExpression('5', '00'), '0');
});

test('beginNextExpression continues from the result when an operator is pressed', () => {
  assert.equal(beginNextExpression('5', '*'), '5*');
  assert.equal(beginNextExpression('14', '+'), '14+');
  assert.equal(beginNextExpression('3.5', '-'), '3.5-');
  assert.equal(beginNextExpression('8', '/'), '8/');
});
