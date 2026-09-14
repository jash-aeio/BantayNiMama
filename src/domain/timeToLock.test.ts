import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { LockEvent } from './lockLog.ts';
import { lockEpisodes, timeToLockReport, type FrameLogEntry, type LockEpisode } from './timeToLock.ts';

const lock = (kind: LockEvent['kind'], atMs: number, productIds: string[] = []): LockEvent => ({
  atMs,
  kind,
  productIds,
  score: null,
  margin: null,
  votes: [],
});
const frames = (...entries: [number, FrameLogEntry['kind']][]): FrameLogEntry[] => entries.map(([atMs, kind]) => ({ atMs, kind }));

describe('lockEpisodes (NFR-04 proxy, P2-8)', () => {
  test('runs from the Unknown lock to the next result lock; t_seen is the first frame not UNKNOWN', () => {
    const log = frames(
      [0, 'unknown'], [250, 'unknown'], [500, 'unknown'], [750, 'unknown'],
      [1000, 'unknown'], [1250, 'accept'], [1500, 'unknown'], [1750, 'accept'], [2000, 'accept'], [2250, 'accept'],
    );
    const locks = [lock('unknown', 800), lock('none', 1300), lock('accept', 2350, ['p'])];
    assert.deepEqual(lockEpisodes(log, locks), {
      episodes: [{ unknownMs: 800, seenMs: 1250, lockMs: 2350, lockKind: 'accept', productIds: ['p'], proxyMs: 1100 }],
      truncated: 0,
      inconsistent: 0,
    });
  });

  test('only the first result after an Unknown counts: chips settling into a lock are one episode', () => {
    const log = frames([100, 'unknown'], [600, 'disambiguate'], [1400, 'accept']);
    const report = lockEpisodes(log, [lock('unknown', 200), lock('disambiguate', 1000, ['p', 'q']), lock('accept', 1500, ['p'])]);
    assert.deepEqual(report.episodes.map((e) => [e.lockKind, e.proxyMs]), [['disambiguate', 400]]);
  });

  test('a second Unknown before any result reopens the episode', () => {
    const log = frames([100, 'unknown'], [300, 'accept'], [600, 'unknown'], [900, 'accept'], [1100, 'accept']);
    const report = lockEpisodes(log, [lock('unknown', 200), lock('none', 400), lock('unknown', 800), lock('accept', 1200, ['p'])]);
    assert.deepEqual(report.episodes.map((e) => [e.unknownMs, e.seenMs]), [[800, 900]]);
  });

  test('grid locks are results', () => {
    const report = lockEpisodes(frames([0, 'unknown'], [500, 'quickPick']), [lock('unknown', 100), lock('quickPick', 900, ['bag'])]);
    assert.equal(report.episodes[0]?.lockKind, 'quickPick');
  });

  test('an episode that opened before the oldest logged frame is left out, not guessed', () => {
    const report = lockEpisodes(frames([1000, 'accept']), [lock('unknown', 500), lock('accept', 1500, ['p'])]);
    assert.deepEqual(report, { episodes: [], truncated: 1, inconsistent: 0 });
  });

  test('a result lock with no earlier non-UNKNOWN frame is reported: the two clocks disagree', () => {
    const report = lockEpisodes(frames([0, 'unknown'], [2000, 'accept']), [lock('unknown', 100), lock('accept', 1500, ['p'])]);
    assert.deepEqual(report, { episodes: [], truncated: 0, inconsistent: 1 });
  });

  test('results before any Unknown lock open no episode', () => {
    assert.deepEqual(lockEpisodes(frames([0, 'accept']), [lock('accept', 900, ['p'])]).episodes, []);
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
