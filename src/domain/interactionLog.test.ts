import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { appendInteraction, countInteractions, type Interaction } from './interactionLog.ts';

const at = (atMs: number, kind: Interaction['kind'], productIds: string[] = []): Interaction => ({ atMs, kind, productIds });

describe('interaction log (PHASE_2_PLAN §4)', () => {
  test('appends in order and keeps only the newest entries past the limit', () => {
    let log: Interaction[] = [];
    for (let i = 0; i < 5; i++) log = appendInteraction(log, at(i, 'confirmYes', ['p']), 3);
    assert.deepEqual(log.map((e) => e.atMs), [2, 3, 4]);
  });

  test('counts each kind in first-seen order', () => {
    const log = [at(1, 'confirmNo', ['p']), at(2, 'notInListStart', ['p']), at(3, 'notInListSaved', ['p']), at(4, 'confirmNo', ['q'])];
    assert.deepEqual(countInteractions(log), [
      ['confirmNo', 2],
      ['notInListStart', 1],
      ['notInListSaved', 1],
    ]);
    assert.deepEqual(countInteractions([]), []);
  });
});
