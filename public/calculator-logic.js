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
      const currentNumber = formula.split(/[+\-*/()]/).pop();
      if (currentNumber.includes('.')) {
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

  return { appendValue, formatResult };
});
