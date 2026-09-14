import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { likelyDuplicates, parseEnrollmentForm, type EnrollmentForm } from './enrollment.ts';

const form = (overrides: Partial<EnrollmentForm> = {}): EnrollmentForm => ({
  name: 'Lucky Me Pancit Canton Kalamansi',
  pricePiece: '17.50',
  pricePack: '',
  unitLabel: '',
  category: '',
  ...overrides,
});

const thresholds = { tau: 0.46, delta: 0.075 };

describe('parseEnrollmentForm (SR-21, TR-41)', () => {
  test('parses prices to centavos and trims text', () => {
    assert.deepEqual(
      parseEnrollmentForm(form({ name: '  Kopiko Brown  ', pricePiece: '₱8', pricePack: '1,050.00', unitLabel: ' sachet ', category: 'kape' })),
      {
        ok: true,
        product: { name: 'Kopiko Brown', pricePiece: 800, pricePack: 105000, unitLabel: 'sachet', category: 'kape' },
      },
    );
  });

  test('turns blank optional fields into null', () => {
    const parsed = parseEnrollmentForm(form({ unitLabel: '   ', category: '' }));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.product.pricePack, null);
      assert.equal(parsed.product.unitLabel, null);
      assert.equal(parsed.product.category, null);
    }
  });

  test('reports every bad field at once', () => {
    assert.deepEqual(parseEnrollmentForm(form({ name: ' ', pricePiece: '', pricePack: 'abc' })), {
      ok: false,
      errors: ['nameRequired', 'piecePriceRequired', 'packPriceInvalid'],
    });
  });

  test('refuses a price that would need rounding', () => {
    assert.deepEqual(parseEnrollmentForm(form({ pricePiece: '12.505' })), { ok: false, errors: ['piecePriceInvalid'] });
  });

  test('refuses a zero price, which can only be a typo (NFR-02)', () => {
    assert.deepEqual(parseEnrollmentForm(form({ pricePiece: '0.00' })), { ok: false, errors: ['piecePriceInvalid'] });
    assert.deepEqual(parseEnrollmentForm(form({ pricePack: '0' })), { ok: false, errors: ['packPriceInvalid'] });
  });

  test('refuses a negative price', () => {
    assert.deepEqual(parseEnrollmentForm(form({ pricePiece: '-5' })), { ok: false, errors: ['piecePriceInvalid'] });
  });
});

describe('likelyDuplicates (SR-23)', () => {
  test('ranks a product by its best score over every new shot', () => {
    const duplicates = likelyDuplicates(
      [
        [
          { productId: 'a', similarity: 0.5 },
          { productId: 'b', similarity: 0.6 },
        ],
        [{ productId: 'a', similarity: 0.9 }],
      ],
      thresholds,
    );
    assert.deepEqual(duplicates, [
      { productId: 'a', score: 0.9 },
      { productId: 'b', score: 0.6 },
    ]);
  });

  test('counts a score exactly at τ, the bar at which the scanner would name it', () => {
    assert.deepEqual(likelyDuplicates([[{ productId: 'a', similarity: 0.46 }]], thresholds), [{ productId: 'a', score: 0.46 }]);
  });

  test('ignores products below τ', () => {
    assert.deepEqual(likelyDuplicates([[{ productId: 'a', similarity: 0.4599 }]], thresholds), []);
  });

  test('finds nothing in an empty catalog', () => {
    assert.deepEqual(likelyDuplicates([[], [], []], thresholds), []);
  });

  test('refuses a NaN τ rather than warning about nothing (TR-35)', () => {
    assert.throws(() => likelyDuplicates([[{ productId: 'a', similarity: 0.9 }]], { tau: NaN, delta: 0.075 }), RangeError);
  });
});
