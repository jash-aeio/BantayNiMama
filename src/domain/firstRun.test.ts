import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { FIRST_RUN_DISMISSED_VALUE, firstRunState } from './firstRun.ts';

describe('firstRunState (SR-44)', () => {
  test('an empty catalog, never dismissed, opens the welcome flow', () => {
    assert.deepEqual(firstRunState(0, null), { kind: 'welcome' });
  });

  test('"Finish later" on an empty catalog leaves the 0 of 5 banner', () => {
    assert.deepEqual(firstRunState(0, FIRST_RUN_DISMISSED_VALUE), { kind: 'banner', done: 0, target: 5 });
  });

  test('a flow left part-way resumes as the banner, dismissed or not', () => {
    assert.deepEqual(firstRunState(2, null), { kind: 'banner', done: 2, target: 5 });
    assert.deepEqual(firstRunState(4, FIRST_RUN_DISMISSED_VALUE), { kind: 'banner', done: 4, target: 5 });
  });

  test('five products complete it; deleting back below five brings the banner back', () => {
    assert.deepEqual(firstRunState(5, null), { kind: 'complete' });
    assert.deepEqual(firstRunState(40, FIRST_RUN_DISMISSED_VALUE), { kind: 'complete' });
    assert.deepEqual(firstRunState(4, null), { kind: 'banner', done: 4, target: 5 });
  });

  test('an unrecognised saved value counts as not dismissed, and never throws', () => {
    for (const saved of ['', 'true', '0', ' 1']) assert.deepEqual(firstRunState(0, saved), { kind: 'welcome' }, saved);
  });

  test('refuses a count that is not a whole, non-negative number', () => {
    for (const n of [NaN, -1, 2.5]) assert.throws(() => firstRunState(n, null), RangeError, String(n));
  });
});
