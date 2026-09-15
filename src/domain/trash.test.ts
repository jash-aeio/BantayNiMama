import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { canUndoDelete, isPurgeable, purgeableIds, TRASH_RETENTION_MS, UNDO_WINDOW_MS } from './trash.ts';

describe('trash (SR-32)', () => {
  test('the windows: 10 s to undo, 30 days in the trash', () => {
    assert.equal(UNDO_WINDOW_MS, 10_000);
    assert.equal(TRASH_RETENTION_MS, 2_592_000_000);
  });

  test('undo is honoured for 10 s after the delete, and not at 10 s', () => {
    assert.equal(canUndoDelete(1_000, 1_000), true);
    assert.equal(canUndoDelete(1_000, 10_999), true);
    assert.equal(canUndoDelete(1_000, 11_000), false);
  });

  test('a clock gone backwards does not honour undo', () => {
    assert.equal(canUndoDelete(5_000, 4_999), false);
  });

  test('a trashed product is purged only after 30 full days', () => {
    assert.equal(isPurgeable(0, TRASH_RETENTION_MS - 1), false);
    assert.equal(isPurgeable(0, TRASH_RETENTION_MS), true);
  });

  test('a clock set backwards never purges', () => {
    assert.equal(isPurgeable(TRASH_RETENTION_MS * 2, 0), false);
  });

  test('purgeableIds keeps only the expired', () => {
    const now = TRASH_RETENTION_MS + 100;
    const trash = [
      { id: 'old', deletedAt: 0 },
      { id: 'recent', deletedAt: 200 },
      { id: 'edge', deletedAt: 100 },
    ];
    assert.deepEqual(purgeableIds(trash, now), ['old', 'edge']);
  });

  test('refuses times that are not whole milliseconds', () => {
    assert.throws(() => canUndoDelete(NaN, 0), RangeError);
    assert.throws(() => isPurgeable(0, 1.5), RangeError);
  });
});
