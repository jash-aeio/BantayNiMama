import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Interaction } from './interactionLog.ts';
import type { LockEvent } from './lockLog.ts';
import {
  appendFrameLog,
  clockCheck,
  confirmDelays,
  lockEpisodes,
  timeToLockReport,
  type FrameLogEntry,
  type LockEpisode,
} from './timeToLock.ts';

const lock = (kind: LockEvent['kind'], atMs: number, productIds: string[] = []): LockEvent => ({
  atMs,
  kind,
  productIds,
  score: null,
  margin: null,
  votes: [],
});
/** Frames captured at `atMs` and received 100 ms later, after 90 ms in the worklet. */
const frames = (...entries: [number, FrameLogEntry['kind']][]): FrameLogEntry[] =>
  entries.map(([atMs, kind]) =>
    kind === 'reset'
      ? { kind, capturedAtMs: atMs, arrivedAtMs: atMs, workletMs: 0 }
      : { kind, capturedAtMs: atMs, arrivedAtMs: atMs + 100, workletMs: 90 },
  );

describe('lockEpisodes (NFR-04 proxy, P2-8)', () => {
  test('runs from the Unknown lock to the next result lock; t_seen is when the first frame not UNKNOWN was captured', () => {
    const log = frames(
      [0, 'unknown'], [250, 'unknown'], [500, 'unknown'], [750, 'unknown'],
      [1000, 'unknown'], [1250, 'accept'], [1500, 'unknown'], [1750, 'accept'], [2000, 'accept'], [2250, 'accept'],
    );
    const locks = [lock('unknown', 900), lock('none', 1400), lock('accept', 2350, ['p'])];
    assert.deepEqual(lockEpisodes(log, locks), {
      episodes: [{ unknownMs: 900, seenMs: 1250, lockMs: 2350, lockKind: 'accept', productIds: ['p'], proxyMs: 1100 }],
      truncated: 0,
      interrupted: 0,
      inconsistent: 0,
    });
  });

  test('frames join an episode by arrival: one captured before the Unknown lock but received after it counts', () => {
    // Captured at 800, received at 900; the Unknown lock was stamped at 850.
    const report = lockEpisodes(frames([700, 'unknown'], [800, 'accept'], [1100, 'accept']), [
      lock('unknown', 850),
      lock('accept', 1200, ['p']),
    ]);
    assert.deepEqual(report.episodes.map((e) => [e.seenMs, e.proxyMs]), [[800, 400]]);
  });

  test('only the first result after an Unknown counts: chips settling into a lock are one episode', () => {
    const log = frames([100, 'unknown'], [600, 'disambiguate'], [1400, 'accept']);
    const report = lockEpisodes(log, [lock('unknown', 250), lock('disambiguate', 1000, ['p', 'q']), lock('accept', 1500, ['p'])]);
    assert.deepEqual(report.episodes.map((e) => [e.lockKind, e.proxyMs]), [['disambiguate', 400]]);
  });

  test('a second Unknown before any result reopens the episode', () => {
    const log = frames([100, 'unknown'], [300, 'accept'], [600, 'unknown'], [900, 'accept'], [1100, 'accept']);
    const report = lockEpisodes(log, [lock('unknown', 250), lock('none', 450), lock('unknown', 750), lock('accept', 1200, ['p'])]);
    assert.deepEqual(report.episodes.map((e) => [e.unknownMs, e.seenMs]), [[750, 900]]);
  });

  test('grid locks are results', () => {
    const report = lockEpisodes(frames([0, 'unknown'], [500, 'quickPick']), [lock('unknown', 150), lock('quickPick', 900, ['bag'])]);
    assert.equal(report.episodes[0]?.lockKind, 'quickPick');
  });

  test('a scanner reset inside the episode leaves it out as interrupted', () => {
    const log = frames([0, 'unknown'], [400, 'reset'], [600, 'accept'], [900, 'accept']);
    const report = lockEpisodes(log, [lock('unknown', 150), lock('accept', 1100, ['p'])]);
    assert.deepEqual(report, { episodes: [], truncated: 0, interrupted: 1, inconsistent: 0 });
  });

  test('an episode that opened before the oldest logged frame is left out, not guessed', () => {
    const report = lockEpisodes(frames([1000, 'accept']), [lock('unknown', 500), lock('accept', 1500, ['p'])]);
    assert.deepEqual(report, { episodes: [], truncated: 1, interrupted: 0, inconsistent: 0 });
  });

  test('a result lock with no non-UNKNOWN frame before it is reported: the two clocks disagree', () => {
    const report = lockEpisodes(frames([0, 'unknown'], [2000, 'accept']), [lock('unknown', 150), lock('accept', 1500, ['p'])]);
    assert.deepEqual(report, { episodes: [], truncated: 0, interrupted: 0, inconsistent: 1 });
  });

  test('t_seen after t_lock is reported, not turned into a negative time', () => {
    const skewed: FrameLogEntry[] = [
      { kind: 'unknown', capturedAtMs: 0, arrivedAtMs: 100, workletMs: 90 },
      { kind: 'accept', capturedAtMs: 5000, arrivedAtMs: 600, workletMs: 90 },
    ];
    assert.equal(lockEpisodes(skewed, [lock('unknown', 150), lock('accept', 700, ['p'])]).inconsistent, 1);
  });

  test('results before any Unknown lock open no episode', () => {
    assert.deepEqual(lockEpisodes(frames([0, 'accept']), [lock('accept', 900, ['p'])]).episodes, []);
  });
});

describe('appendFrameLog', () => {
  test('keeps the newest entries, trimming in chunks rather than on every append', () => {
    const log: FrameLogEntry[] = [];
    for (let i = 0; i < 11; i++) appendFrameLog(log, { kind: 'unknown', capturedAtMs: i, arrivedAtMs: i, workletMs: 0 }, 10);
    assert.equal(log.length, 11, 'within the 10% slack: not trimmed yet');
    appendFrameLog(log, { kind: 'unknown', capturedAtMs: 11, arrivedAtMs: 11, workletMs: 0 }, 10);
    assert.deepEqual(log.map((f) => f.capturedAtMs), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('clockCheck', () => {
  test('transit is arrival minus capture minus worklet time; resets are ignored', () => {
    const check = clockCheck([
      { kind: 'unknown', capturedAtMs: 0, arrivedAtMs: 130, workletMs: 120 },
      { kind: 'reset', capturedAtMs: 200, arrivedAtMs: 200, workletMs: 0 },
      { kind: 'accept', capturedAtMs: 250, arrivedAtMs: 380, workletMs: 125 },
      { kind: 'accept', capturedAtMs: 500, arrivedAtMs: 619, workletMs: 120.6 },
    ]);
    assert.deepEqual(check.transit, { n: 3, median: 5, p90: 10, max: 10 });
    assert.ok(Math.abs((check.transitMinMs ?? NaN) - -1.6) < 1e-9);
    assert.equal(check.impossible, 0, 'within whole-millisecond rounding');
  });

  test('a frame received before the worklet could have finished it counts as impossible', () => {
    const check = clockCheck([{ kind: 'accept', capturedAtMs: 1000, arrivedAtMs: 1050, workletMs: 120 }]);
    assert.equal(check.impossible, 1);
    assert.equal(check.transitMinMs, -70);
  });

  test('no frames → nothing to report', () => {
    assert.deepEqual(clockCheck([]), { transit: null, transitMinMs: null, impossible: 0 });
  });
});

describe('confirmDelays (lock → Yes, informational)', () => {
  const yes = (atMs: number, id: string): Interaction => ({ atMs, kind: 'confirmYes', productIds: [id] });

  test('from the ACCEPT lock to the Yes tapped on it', () => {
    const locks = [lock('unknown', 0), lock('accept', 1000, ['p']), lock('unknown', 5000), lock('accept', 7000, ['q'])];
    assert.deepEqual(confirmDelays(locks, [yes(2500, 'p'), yes(7800, 'q')]), [1500, 800]);
  });

  test('a Yes for another product than the latest lock, or a second Yes on one lock, is left out', () => {
    const locks = [lock('accept', 1000, ['p']), lock('accept', 3000, ['q'])];
    assert.deepEqual(confirmDelays(locks, [yes(2000, 'p'), yes(2100, 'p'), yes(3500, 'p')]), [1000]);
  });

  test('other taps are ignored', () => {
    const tap: Interaction = { atMs: 1500, kind: 'confirmNo', productIds: ['p'] };
    assert.deepEqual(confirmDelays([lock('accept', 1000, ['p'])], [tap]), []);
  });
});

describe('timeToLockReport', () => {
  const episode = (proxyMs: number): LockEpisode => ({
    unknownMs: 0,
    seenMs: 0,
    lockMs: proxyMs,
    lockKind: 'accept',
    productIds: ['p'],
    proxyMs,
  });
  const ten = [800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700].map(episode);

  test('nearest-rank median and p90 of the proxy, and the p90 adjusted by the median bias', () => {
    const report = timeToLockReport(ten, [
      { enterMs: 0, seenMs: 100 },
      { enterMs: 0, seenMs: 300 },
      { enterMs: 0, seenMs: 200 },
    ]);
    assert.deepEqual(report.proxy, { n: 10, median: 1200, p90: 1600, max: 1700 });
    assert.equal(report.bias?.median, 200);
    assert.equal(report.correctedP90Ms, 1800);
  });

  test('no calibration yet → no adjusted p90; no episodes → no proxy', () => {
    assert.equal(timeToLockReport(ten).correctedP90Ms, null);
    assert.deepEqual(timeToLockReport([]), { proxy: null, bias: null, correctedP90Ms: null });
  });
});
