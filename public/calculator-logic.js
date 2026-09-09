(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.CalculatorLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function appendValue(currentFormula, value) {
    const formula = typeof currentFormula === 'string' ? currentFormula : '0';
    const isDigit = /^[0-9]$/.test(value);

    if (value === '00') {
      if (formula === '0' || formula === '') {
        return '0';
      }

      if (/[+\-*/(]$/.test(formula)) {
        return formula + '0';
      }

      return formula + '00';
    }

    if (formula === '0' && isDigit) {
      return value;
    }

    if (formula === '0' && value === '.') {
      return '0.';
    }

    if (formula === '0' && value === '(') {
      return '(';
    }

    if (value === '.') {
      const currentOperand = formula.split(/[+\-*/()]/).pop();
      if (currentOperand.includes('.')) {
        return formula;
      }
    }

    return formula + value;
  }

  function formatResult(value) {
    if (!Number.isFinite(value)) {
      return 'Error';
    }

    const rounded = Number(value.toFixed(10));
    return rounded.toString();
  }

  // After a successful evaluation: digits/./( start fresh; operators continue from the result.
  function beginNextExpression(previousResult, value) {
    const isOperator = /^[+\-*/]$/.test(value);
    const resultText = previousResult == null ? '' : String(previousResult);

    if (isOperator && resultText !== '' && resultText !== 'Error') {
      return resultText + value;
    }

    return appendValue('0', value);
  }

  return { appendValue, formatResult, beginNextExpression };
});
