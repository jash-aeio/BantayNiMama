import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { persistenceProblems, selfMatchReport, type PersistenceInput } from './gateCheck.ts';

const identity = { schemaVersion: 1, modelId: 'mobilenet_v3_large_embedder_v1', embeddingDim: 1280 };

const healthy = (overrides: Partial<PersistenceInput> = {}): PersistenceInput => ({
  counts: { products: 20, shots: 100, negatives: 0 },
  indexSize: 100,
  otherModelShots: 0,
  trashedShots: 0,
  meta: identity,
  expected: identity,
  missingPhotos: [],
  ...overrides,
});

describe('persistenceProblems (PHASE_1_PLAN §4 step 3)', () => {
  test('a catalog that survived intact has no problems', () => {
    assert.deepEqual(persistenceProblems(healthy()), []);
  });

  test('an empty catalog fails: a check over nothing proves nothing', () => {
    assert.deepEqual(persistenceProblems(healthy({ counts: { products: 0, shots: 0, negatives: 0 }, indexSize: 0 })), [
      { kind: 'emptyCatalog' },
    ]);
  });

  test('reports app_meta that does not match the build', () => {
    const problems = persistenceProblems(
      healthy({ meta: { schemaVersion: 2, modelId: 'other', embeddingDim: 1024 } }),
    );
    assert.deepEqual(
      problems.map((p) => p.kind),
      ['schemaVersion', 'modelId', 'embeddingDim'],
    );
  });

  test('a shot row that is neither searchable nor another model\'s was lost', () => {
    assert.deepEqual(persistenceProblems(healthy({ indexSize: 99 })), [
      { kind: 'indexMismatch', indexSize: 99, otherModelShots: 0, trashedShots: 0, rows: 100 },
    ]);
  });

  test('other-model shots account for rows left out of the index (TR-23)', () => {
    assert.deepEqual(persistenceProblems(healthy({ indexSize: 95, otherModelShots: 5 })), []);
  });

  test('negatives are rows the index must hold; trashed products\' shots are rows it leaves out (TR-39, SR-32)', () => {
    const withNegatives = { products: 20, shots: 100, negatives: 7 };
    assert.deepEqual(persistenceProblems(healthy({ counts: withNegatives, indexSize: 102, trashedShots: 5 })), []);
    assert.deepEqual(persistenceProblems(healthy({ counts: withNegatives, indexSize: 100 })), [
      { kind: 'indexMismatch', indexSize: 100, otherModelShots: 0, trashedShots: 0, rows: 107 },
    ]);
  });

  test('lists every missing photo (TR-43)', () => {
    assert.deepEqual(persistenceProblems(healthy({ missingPhotos: ['photos/a.jpg', 'photos/b.jpg'] })), [
      { kind: 'missingPhotos', paths: ['photos/a.jpg', 'photos/b.jpg'] },
    ]);
  });
});

describe('selfMatchReport (PHASE_1_PLAN §4 step 4)', () => {
  const hit = (shotId: string, similarity: number) => ({ shotId, productId: `p-${shotId}`, similarity });

  test('passes when every photo finds its own vector first', () => {
    const report = selfMatchReport([
      { shotId: 'a', hits: [hit('a', 1), hit('b', 0.7)] },
      { shotId: 'b', hits: [hit('b', 0.999999), hit('a', 0.7)] },
    ]);
    assert.equal(report.passed, true);
    assert.equal(report.shots, 2);
    assert.deepEqual(report.failures, []);
    assert.equal(report.ownScoreMin, 0.999999);
    assert.equal(report.nearestOther?.max, 0.7);
  });

  test('fails a shot whose nearest neighbour is another shot', () => {
    const report = selfMatchReport([{ shotId: 'a', hits: [hit('b', 0.95), hit('a', 0.9)] }]);
    assert.equal(report.passed, false);
    assert.deepEqual(report.failures, [{ shotId: 'a', nearestShotId: 'b', nearestScore: 0.95 }]);
    assert.equal(report.ownScoreMin, 0.9);
  });

  test('fails a shot whose own vector is missing from the index', () => {
    const report = selfMatchReport([{ shotId: 'a', hits: [hit('b', 0.5)] }]);
    assert.equal(report.passed, false);
    assert.equal(report.ownScore, null);
    assert.equal(report.ownScoreMin, null);
  });

  test('fails a shot with no hits at all', () => {
    assert.deepEqual(selfMatchReport([{ shotId: 'a', hits: [] }]).failures, [
      { shotId: 'a', nearestShotId: null, nearestScore: null },
    ]);
  });

  test('never passes over zero shots', () => {
    assert.equal(selfMatchReport([]).passed, false);
  });
});
