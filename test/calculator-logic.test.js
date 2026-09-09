const test = require('node:test');
const assert = require('node:assert/strict');
const {
  appendValue,
  formatResult,
  beginNextExpression
} = require('../public/calculator-logic');

// This regression test preserves the fix that lets a calculation begin with a
// grouping expression instead of producing the invalid text "0(".
test('appendValue replaces the initial zero when a parenthesis is entered first', () => {
  assert.equal(appendValue('0', '('), '(');
});

// These cases document how the calculator normalizes its initial display and
// the special "00" button before text reaches the server-side evaluator.
test('appendValue normalizes initial digits, decimals, and double-zero input', () => {
  const cases = [
    { formula: '0', value: '7', expected: '7' },
    { formula: '0', value: '.', expected: '0.' },
    { formula: '0', value: '00', expected: '0' },
    { formula: '', value: '00', expected: '0' },
    { formula: '1+', value: '00', expected: '1+0' },
    { formula: '12', value: '00', expected: '1200' }
  ];

  for (const { formula, value, expected } of cases) {
    assert.equal(
      appendValue(formula, value),
      expected,
      `${JSON.stringify(value)} after ${JSON.stringify(formula)}`
    );
  }
});

// Decimal suppression applies to the number currently being entered, not to
// the whole expression. This permits 1.5+2.5 while blocking 1.5+2.5.6.
test('appendValue permits one decimal point in each operand', () => {
  assert.equal(appendValue('1.5+2', '.'), '1.5+2.');
  assert.equal(appendValue('1.5+2.5', '.'), '1.5+2.5');
  assert.equal(appendValue('(1.5)*2', '.'), '(1.5)*2.');
});

// Ordinary operators, parentheses, and digits should be appended verbatim so
// button entry constructs the same expression accepted by POST /calculate.
test('appendValue appends ordinary calculator input', () => {
  const cases = [
    { formula: '12', value: '+', expected: '12+' },
    { formula: '12+', value: '(', expected: '12+(' },
    { formula: '12+(', value: '3', expected: '12+(3' },
    { formula: '12+(3', value: ')', expected: '12+(3)' }
  ];

  for (const { formula, value, expected } of cases) {
    assert.equal(appendValue(formula, value), expected);
  }
});

// Result formatting mirrors the API's ten-decimal normalization and prevents
// NaN or infinities from being rendered as successful calculator values.
test('formatResult rounds finite values and rejects non-finite values', () => {
  const cases = [
    { value: 0.1 + 0.2, expected: '0.3' },
    { value: 1 / 3, expected: '0.3333333333' },
    { value: -0, expected: '0' },
    { value: Number.NaN, expected: 'Error' },
    { value: Number.POSITIVE_INFINITY, expected: 'Error' },
    { value: Number.NEGATIVE_INFINITY, expected: 'Error' }
  ];

  for (const { value, expected } of cases) {
    assert.equal(formatResult(value), expected);
  }
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
