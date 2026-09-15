import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { appendInteraction, countInteractions, enrollmentTimes, type Interaction } from './interactionLog.ts';

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

describe('enrollmentTimes (SR-25)', () => {
  test('times one product from its Add to its save, keeping where it was opened', () => {
    const log = [at(1_000, 'addFromUnknown'), at(3_000, 'chipPick', ['x']), at(22_500, 'enrollSaved', ['a'])];
    assert.deepEqual(enrollmentTimes(log), [
      {
        productId: 'a',
        startMs: 1_000,
        savedMs: 22_500,
        ms: 21_500,
        source: 'unknown',
        photos: 0,
        firstPhotoMs: null,
        lastPhotoMs: null,
        firstKeyMs: null,
      },
    ]);
  });

  test('splits the time into photos and typing, as offsets from the Add', () => {
    const log = [
      at(10_000, 'addFromButton'),
      at(14_000, 'enrollPhoto'),
      at(17_000, 'enrollPhoto'),
      at(20_000, 'enrollPhoto'),
      at(23_000, 'enrollTyping'),
      at(26_000, 'enrollTyping'),
      at(35_000, 'enrollSaved', ['a']),
    ];
    const [time] = enrollmentTimes(log);
    assert.deepEqual(
      { ms: time?.ms, photos: time?.photos, first: time?.firstPhotoMs, last: time?.lastPhotoMs, key: time?.firstKeyMs },
      { ms: 25_000, photos: 3, first: 4_000, last: 10_000, key: 13_000 },
    );
  });

  test('the next product saved without closing the panel is timed from the previous save, with its own split', () => {
    const log = [
      at(0, 'addFromFirstRun'),
      at(5_000, 'enrollPhoto'),
      at(20_000, 'enrollSaved', ['a']),
      at(28_000, 'enrollPhoto'),
      at(45_000, 'enrollSaved', ['b']),
    ];
    assert.deepEqual(
      enrollmentTimes(log).map(({ productId, ms, source, photos, firstPhotoMs }) => ({ productId, ms, source, photos, firstPhotoMs })),
      [
        { productId: 'a', ms: 20_000, source: 'firstRun', photos: 1, firstPhotoMs: 5_000 },
        { productId: 'b', ms: 25_000, source: 'continued', photos: 1, firstPhotoMs: 8_000 },
      ],
    );
  });

  test('closing the panel abandons the episode, and its photos; the next Add starts a fresh one', () => {
    const log = [
      at(0, 'addFromButton'),
      at(2_000, 'enrollPhoto'),
      at(5_000, 'enrollClosed'),
      at(60_000, 'addFromBanner'),
      at(80_000, 'enrollSaved', ['a']),
      at(81_000, 'enrollClosed'),
    ];
    const times = enrollmentTimes(log);
    assert.equal(times.length, 1);
    assert.deepEqual(
      { startMs: times[0]?.startMs, ms: times[0]?.ms, source: times[0]?.source, photos: times[0]?.photos },
      { startMs: 60_000, ms: 20_000, source: 'banner', photos: 0 },
    );
  });

  test('a second Add while the panel is open keeps the earlier start', () => {
    const log = [at(0, 'addFromButton'), at(4_000, 'addFromUnknown'), at(10_000, 'enrollSaved', ['a'])];
    assert.equal(enrollmentTimes(log)[0]?.ms, 10_000);
    assert.equal(enrollmentTimes(log)[0]?.source, 'button');
  });

  test('photos and keystrokes outside an open episode are ignored', () => {
    const log = [at(0, 'enrollPhoto'), at(1_000, 'enrollTyping'), at(2_000, 'addFromButton'), at(9_000, 'enrollSaved', ['a'])];
    const [time] = enrollmentTimes(log);
    assert.deepEqual({ photos: time?.photos, key: time?.firstKeyMs }, { photos: 0, key: null });
  });

  test('a save with no Add before it is left out, not guessed', () => {
    assert.deepEqual(enrollmentTimes([at(10_000, 'enrollSaved', ['a'])]), []);
    assert.deepEqual(enrollmentTimes([]), []);
  });
});
