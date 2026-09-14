import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { quickPickTiles, type TileProduct } from './quickPick.ts';

const p = (id: string, name: string): TileProduct => ({ id, name });
const ids = (tiles: readonly TileProduct[]) => tiles.map((t) => t.id);

describe('quickPickTiles (SR-10, ADR-018)', () => {
  test('lists every repacked product by name, ignoring case', () => {
    assert.deepEqual(ids(quickPickTiles([p('m', 'monggo'), p('a', 'Asukal'), p('s', 'asin')], [])), ['s', 'a', 'm']);
  });

  test('the order never depends on which bag the frame ranked first', () => {
    const repacked = [p('a', 'Asukal'), p('s', 'Asin'), p('m', 'Monggo')];
    const expected = ['s', 'a', 'm'];
    assert.deepEqual(ids(quickPickTiles(repacked, [p('m', 'Monggo')])), expected);
    assert.deepEqual(ids(quickPickTiles(repacked, [p('a', 'Asukal'), p('s', 'Asin')])), expected);
  });

  test('adds a non-repacked product the frame involved, once, in name order', () => {
    assert.deepEqual(ids(quickPickTiles([p('a', 'Asukal'), p('m', 'Monggo')], [p('m', 'Monggo'), p('k', 'Kape'), p('k', 'Kape')])), [
      'a',
      'k',
      'm',
    ]);
  });

  test('keeps the repacked row when an id arrives twice', () => {
    type Tile = TileProduct & { photoPath: string | null };
    const repacked: Tile = { id: 'a', name: 'Asukal', photoPath: 'photos/a1.jpg' };
    const involved: Tile = { id: 'a', name: 'Asukal', photoPath: null };
    assert.equal(quickPickTiles([repacked], [involved])[0], repacked);
  });

  test('a name tie falls back to id, so the order is stable', () => {
    assert.deepEqual(ids(quickPickTiles([p('b', 'Asin'), p('a', 'asin')], [])), ['a', 'b']);
  });

  test('no repacked products and nothing involved gives no tiles', () => {
    assert.deepEqual(quickPickTiles([], []), []);
  });
});
