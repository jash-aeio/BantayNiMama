import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { summarize } from './stats.ts';

describe('summarize', () => {
  test('uses nearest-rank percentiles, so every number is a real sample', () => {
    assert.deepEqual(summarize([10, 1, 9, 2, 8, 3, 7, 4, 6, 5]), { n: 10, median: 5, p90: 9, max: 10 });
  });

  test('a single sample is its own median, p90 and max', () => {
    assert.deepEqual(summarize([145.5]), { n: 1, median: 145.5, p90: 145.5, max: 145.5 });
  });

  test('drops non-finite samples and returns null when none are left', () => {
    assert.deepEqual(summarize([NaN, 3, Infinity]), { n: 1, median: 3, p90: 3, max: 3 });
    assert.equal(summarize([]), null);
    assert.equal(summarize([NaN]), null);
  });

  test('does not reorder the caller’s array', () => {
    const samples = [3, 1, 2];
    summarize(samples);
    assert.deepEqual(samples, [3, 1, 2]);
  });
});
