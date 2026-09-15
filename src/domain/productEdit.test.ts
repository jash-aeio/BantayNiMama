import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { planProductEdit, productFormOf, type EditableProduct } from './productEdit.ts';

const kape: EditableProduct = {
  name: 'Kopiko Brown',
  pricePiece: 1000,
  pricePack: 9500,
  unitLabel: 'sachet',
  category: null,
  isAmbiguous: false,
};

describe('planProductEdit (SR-31)', () => {
  test('the starting form reads back as unchanged', () => {
    assert.deepEqual(planProductEdit(kape, productFormOf(kape)), { kind: 'unchanged' });
  });

  test('the same values typed differently are unchanged: trailing spaces, "10" for 10.00, a blank for none', () => {
    const form = { ...productFormOf(kape), name: '  Kopiko Brown ', pricePiece: '10', pricePack: '95.0', category: '   ' };
    assert.deepEqual(planProductEdit(kape, form), { kind: 'unchanged' });
  });

  test('a rename changes the details only, so no price_history row is written', () => {
    const edit = planProductEdit(kape, { ...productFormOf(kape), name: 'Kopiko Brown Coffee' });
    assert.deepEqual(edit, {
      kind: 'change',
      details: { name: 'Kopiko Brown Coffee', unitLabel: 'sachet', category: null, isAmbiguous: false },
      prices: null,
    });
  });

  test('a price change carries both prices as centavos', () => {
    const edit = planProductEdit(kape, { ...productFormOf(kape), pricePiece: '12.50', pricePack: '' });
    assert.equal(edit.kind, 'change');
    assert.deepEqual(edit.kind === 'change' ? edit.prices : undefined, { pricePiece: 1250, pricePack: null });
  });

  test('the repacked flag alone is a change', () => {
    const edit = planProductEdit(kape, { ...productFormOf(kape), isAmbiguous: true });
    assert.equal(edit.kind === 'change' && edit.details.isAmbiguous, true);
    assert.equal(edit.kind === 'change' ? edit.prices : undefined, null);
  });

  test("invalid input returns enrollment's errors, all at once", () => {
    const edit = planProductEdit(kape, { ...productFormOf(kape), name: ' ', pricePiece: '0', pricePack: 'abc' });
    assert.deepEqual(edit, { kind: 'invalid', errors: ['nameRequired', 'piecePriceInvalid', 'packPriceInvalid'] });
  });

  test('a product with no stored price can be given one', () => {
    const noPrice: EditableProduct = { ...kape, pricePiece: null, pricePack: null };
    assert.deepEqual(productFormOf(noPrice).pricePiece, '');
    const edit = planProductEdit(noPrice, { ...productFormOf(noPrice), pricePiece: '8' });
    assert.deepEqual(edit.kind === 'change' ? edit.prices : undefined, { pricePiece: 800, pricePack: null });
  });
});
