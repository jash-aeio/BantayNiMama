import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeForSearch, searchProducts } from './productSearch.ts';

const items = [
  { id: '1', name: 'Datu Puti Soy Sauce' },
  { id: '2', name: 'Datu Puti Vinegar' },
  { id: '3', name: 'Lucky Me Beef' },
  { id: '4', name: 'Lucky Me Pancit Canton Kalamansi' },
  { id: '5', name: 'Piña Juice' },
  { id: '6', name: 'Silver Swan Soy Sauce' },
];
const ids = (found: readonly { id: string }[]) => found.map((p) => p.id);

describe('searchProducts (SR-07, SR-30)', () => {
  test('ignores case, accents and extra spaces', () => {
    assert.equal(normalizeForSearch('  PIÑA   Juice '), 'pina juice');
    assert.deepEqual(ids(searchProducts(items, 'pina')), ['5']);
    assert.deepEqual(ids(searchProducts(items, 'LUCKY  me')), ['3', '4']);
  });

  test('every word must appear, in any order', () => {
    assert.deepEqual(ids(searchProducts(items, 'beef lucky')), ['3']);
    assert.deepEqual(ids(searchProducts(items, 'datu vinegar')), ['2']);
    assert.deepEqual(ids(searchProducts(items, 'datu coffee')), []);
  });

  test('names starting with the first word come first, otherwise input order holds', () => {
    assert.deepEqual(ids(searchProducts(items, 'soy')), ['1', '6']);
    assert.deepEqual(ids(searchProducts(items, 'silver soy')), ['6']);
    assert.deepEqual(ids(searchProducts(items, 's')), ['6', '1', '4']);
  });

  test('a blank query finds nothing, and the limit holds', () => {
    assert.deepEqual(searchProducts(items, '   '), []);
    assert.deepEqual(ids(searchProducts(items, 'a', 2)), ['1', '2']);
  });
});
