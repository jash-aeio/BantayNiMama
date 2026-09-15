import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  directoryView,
  filterByName,
  formatBytes,
  scannedProductIds,
  sortDirectory,
  storageSummary,
  type DirectoryEntry,
} from './directory.ts';

const entry = (id: string, name: string, createdAt: number, lastScannedAt: number | null = null): DirectoryEntry => ({
  id,
  name,
  createdAt,
  lastScannedAt,
});

const kape = entry('k', 'Kopiko Brown', 3_000, 9_000);
const pina = entry('p', 'Piña Juice', 1_000, null);
const lucky = entry('l', 'lucky me beef', 2_000, 5_000);
const alaska = entry('a', 'Alaska Evap', 4_000, null);
const all = [kape, pina, lucky, alaska];

describe('filterByName (SR-30)', () => {
  test('every word, any order, case and accents ignored', () => {
    assert.deepEqual(filterByName(all, 'BEEF lucky').map((e) => e.id), ['l']);
    assert.deepEqual(filterByName(all, 'pina').map((e) => e.id), ['p']);
  });

  test('a blank query keeps everything, with no limit', () => {
    assert.equal(filterByName(all, '   ').length, 4);
  });

  test('no match is an empty list', () => {
    assert.deepEqual(filterByName(all, 'zonrox'), []);
  });
});

describe('sortDirectory (SR-34)', () => {
  test('by name: A to Z, case and accents ignored', () => {
    assert.deepEqual(sortDirectory(all, 'name').map((e) => e.id), ['a', 'k', 'l', 'p']);
  });

  test('recently added: newest first', () => {
    assert.deepEqual(sortDirectory(all, 'recentlyAdded').map((e) => e.id), ['a', 'k', 'l', 'p']);
  });

  test('recently scanned: most recent first, never-scanned last by name', () => {
    assert.deepEqual(sortDirectory(all, 'recentlyScanned').map((e) => e.id), ['k', 'l', 'a', 'p']);
  });

  test('ties end on the name, then the id, whatever the input order', () => {
    const twins = [entry('b', 'Same', 1_000, 7), entry('a', 'Same', 1_000, 7), entry('c', 'Other', 1_000, 7)];
    for (const sort of ['name', 'recentlyAdded', 'recentlyScanned'] as const) {
      assert.deepEqual(sortDirectory(twins, sort).map((e) => e.id), ['c', 'a', 'b'], sort);
      assert.deepEqual(sortDirectory([...twins].reverse(), sort).map((e) => e.id), ['c', 'a', 'b'], sort);
    }
  });

  test('never changes its input', () => {
    const input = [...all];
    sortDirectory(input, 'recentlyScanned');
    assert.deepEqual(input, all);
  });

  test('directoryView filters, then sorts', () => {
    assert.deepEqual(directoryView(all, 'k', 'recentlyAdded').map((e) => e.id), ['a', 'k', 'l']);
  });
});

describe('scannedProductIds (SR-34)', () => {
  test('only an ACCEPT names a product', () => {
    assert.deepEqual(scannedProductIds({ kind: 'accept', product: { productId: 'k', score: 0.8 }, margin: 0.2 }), ['k']);
  });

  test('chips, the grid, Unknown and no lock name nothing', () => {
    const chips = {
      kind: 'disambiguate',
      first: { productId: 'a', score: 0.7 },
      second: { productId: 'b', score: 0.69 },
      margin: 0.01,
    } as const;
    assert.deepEqual(scannedProductIds(chips), []);
    assert.deepEqual(scannedProductIds({ kind: 'quickPick', productIds: ['bag'], score: 0.8 }), []);
    assert.deepEqual(scannedProductIds({ kind: 'unknown', best: null }), []);
    assert.deepEqual(scannedProductIds(null), []);
  });
});

describe('storage (SR-35)', () => {
  test('counts photos and adds their sizes', () => {
    assert.deepEqual(storageSummary([{ bytes: 24_100 }, { bytes: 30_600 }]), { count: 2, bytes: 54_700 });
    assert.deepEqual(storageSummary([]), { count: 0, bytes: 0 });
  });

  test('refuses a size that is not whole bytes', () => {
    assert.throws(() => storageSummary([{ bytes: -1 }]), RangeError);
    assert.throws(() => storageSummary([{ bytes: 1.5 }]), RangeError);
  });

  test('formats as B, KB or MB', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1023), '1023 B');
    assert.equal(formatBytes(24_100), '24 KB');
    assert.equal(formatBytes(3_000_000), '2.9 MB');
    assert.throws(() => formatBytes(NaN), RangeError);
  });
});
