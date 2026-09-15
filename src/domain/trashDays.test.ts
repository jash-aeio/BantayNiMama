import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isPurgeable, TRASH_RETENTION_MS, trashDaysLeft } from './trash.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('trashDaysLeft (SR-32)', () => {
  test('a product deleted just now has 30 days', () => {
    assert.equal(trashDaysLeft(1_000, 1_000), 30);
  });

  test('a part day counts as a day, until the purge is due', () => {
    assert.equal(trashDaysLeft(0, 29.5 * DAY), 1);
    assert.equal(trashDaysLeft(0, TRASH_RETENTION_MS - 1), 1);
    assert.equal(trashDaysLeft(0, TRASH_RETENTION_MS), 0);
  });

  test('agrees with isPurgeable: 0 days left exactly when the launch purge would remove it', () => {
    for (const elapsed of [0, DAY, TRASH_RETENTION_MS - 1, TRASH_RETENTION_MS, TRASH_RETENTION_MS + DAY]) {
      assert.equal(trashDaysLeft(0, elapsed) === 0, isPurgeable(0, elapsed), String(elapsed));
    }
  });

  test('a clock set backwards shows 30, never more', () => {
    assert.equal(trashDaysLeft(10 * DAY, 0), 30);
  });

  test('refuses times that are not whole milliseconds', () => {
    assert.throws(() => trashDaysLeft(NaN, 0), RangeError);
  });
});
