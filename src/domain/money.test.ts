import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatCentavos, isCentavos, parsePesos } from './money.ts';

describe('isCentavos (TR-41)', () => {
  test('accepts whole, non-negative centavos', () => {
    assert.equal(isCentavos(0), true);
    assert.equal(isCentavos(1250), true);
  });

  test('rejects floats, negatives, NaN and non-numbers', () => {
    for (const bad of [12.5, -1, NaN, Infinity, 2 ** 53, '1250', null]) {
      assert.equal(isCentavos(bad), false, String(bad));
    }
  });
});

describe('parsePesos (TR-41)', () => {
  test('parses the ways a price gets typed', () => {
    assert.equal(parsePesos('12.50'), 1250);
    assert.equal(parsePesos('12.5'), 1250);
    assert.equal(parsePesos('12'), 1200);
    assert.equal(parsePesos('0.05'), 5);
    assert.equal(parsePesos('  7 '), 700);
    assert.equal(parsePesos('₱1,250.00'), 125000);
    assert.equal(parsePesos('₱ 15'), 1500);
  });

  test('never goes through a float: "0.29" is 29, where 0.29 * 100 is 28.999999999999996', () => {
    assert.equal(parsePesos('0.29'), 29);
    assert.equal(parsePesos('1.15'), 115);
  });

  test('rejects anything it would have to guess at or round', () => {
    for (const bad of ['', ' ', 'abc', '12.505', '-5', '1,25.00', '12.', '.5', '1e3', 'Infinity', '12,50']) {
      assert.equal(parsePesos(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  test('rejects amounts past the safe-integer range', () => {
    assert.equal(parsePesos('99999999999999999'), null);
  });
});

describe('formatCentavos (ADR-007)', () => {
  test('renders pesos with two decimal places and thousands separators', () => {
    assert.equal(formatCentavos(1250), '₱12.50');
    assert.equal(formatCentavos(5), '₱0.05');
    assert.equal(formatCentavos(0), '₱0.00');
    assert.equal(formatCentavos(125000), '₱1,250.00');
    assert.equal(formatCentavos(123456789), '₱1,234,567.89');
  });

  test('refuses anything that is not whole, non-negative centavos', () => {
    assert.throws(() => formatCentavos(12.5), RangeError);
    assert.throws(() => formatCentavos(-1), RangeError);
    assert.throws(() => formatCentavos(NaN), RangeError);
  });

  test('round-trips with parsePesos', () => {
    for (const centavos of [0, 1, 99, 100, 1250, 999999, 123456789]) {
      assert.equal(parsePesos(formatCentavos(centavos)), centavos);
    }
  });
});
