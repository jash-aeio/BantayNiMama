import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { planPriceEdit } from './priceEdit.ts';

const stored = { pricePiece: 1250, pricePack: 13500 };

describe('planPriceEdit (SR-06, TR-41)', () => {
  test('a new price becomes centavos without a float', () => {
    assert.deepEqual(planPriceEdit(stored, { pricePiece: '13.75', pricePack: '135' }), {
      kind: 'change',
      pricePiece: 1375,
      pricePack: 13500,
    });
  });

  test('an edit that lands on the stored prices writes nothing, however it was typed', () => {
    assert.deepEqual(planPriceEdit(stored, { pricePiece: '12.5', pricePack: '₱135.00' }), { kind: 'unchanged' });
    assert.deepEqual(planPriceEdit({ pricePiece: 1250, pricePack: null }, { pricePiece: '12.50', pricePack: '  ' }), {
      kind: 'unchanged',
    });
  });

  test('blanking the pack price clears it, which is a change', () => {
    assert.deepEqual(planPriceEdit(stored, { pricePiece: '12.50', pricePack: '' }), {
      kind: 'change',
      pricePiece: 1250,
      pricePack: null,
    });
  });

  test('fills in a per-piece price that was never stored', () => {
    assert.deepEqual(planPriceEdit({ pricePiece: null, pricePack: null }, { pricePiece: '8', pricePack: '' }), {
      kind: 'change',
      pricePiece: 800,
      pricePack: null,
    });
  });

  test('the per-piece price is required; every error comes back at once', () => {
    assert.deepEqual(planPriceEdit(stored, { pricePiece: '', pricePack: 'abc' }), {
      kind: 'invalid',
      errors: ['piecePriceRequired', 'packPriceInvalid'],
    });
  });

  test('refuses ₱0.00 and a price that would need rounding', () => {
    for (const pricePiece of ['0', '0.00', '12.505', '-5']) {
      assert.deepEqual(planPriceEdit(stored, { pricePiece, pricePack: '' }), { kind: 'invalid', errors: ['piecePriceInvalid'] }, pricePiece);
    }
    assert.deepEqual(planPriceEdit(stored, { pricePiece: '12', pricePack: '0' }), { kind: 'invalid', errors: ['packPriceInvalid'] });
  });
});
