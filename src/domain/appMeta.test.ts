import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseAppMeta } from './appMeta.ts';

const seeded = {
  schema_version: '1',
  model_id: 'mobilenet_v3_large_embedder_v1',
  embedding_dim: '1280',
  tau: '0.46',
  delta: '0.075',
};

describe('parseAppMeta (TR-35, TR-38)', () => {
  test('parses the schema v1 seed', () => {
    assert.deepEqual(parseAppMeta(seeded), {
      schemaVersion: 1,
      modelId: 'mobilenet_v3_large_embedder_v1',
      embeddingDim: 1280,
      thresholds: { tau: 0.46, delta: 0.075 },
      confirmBelow: null,
    });
  });

  test('confirm_below is optional until Phase 3 calibrates it', () => {
    assert.equal(parseAppMeta(seeded).confirmBelow, null);
    assert.equal(parseAppMeta({ ...seeded, confirm_below: '12' }).confirmBelow, 12);
  });

  test('refuses a blank τ instead of reading it as 0 — which would accept everything', () => {
    assert.throws(() => parseAppMeta({ ...seeded, tau: '' }), /missing "tau"/);
  });

  test('refuses numbers that plain Number() would have half-accepted', () => {
    for (const tau of [' 0.46', '0.46 ', '0.46abc', '.46', '1e-1', 'NaN']) {
      assert.throws(() => parseAppMeta({ ...seeded, tau }), /decimal number/, JSON.stringify(tau));
    }
  });

  test('refuses thresholds outside their range', () => {
    assert.throws(() => parseAppMeta({ ...seeded, tau: '1.5' }), RangeError);
    assert.throws(() => parseAppMeta({ ...seeded, delta: '-0.1' }), RangeError);
  });

  test('refuses a missing model id or a nonsense dimension (TR-23)', () => {
    const { model_id: _dropped, ...withoutModel } = seeded;
    assert.throws(() => parseAppMeta(withoutModel), /missing "model_id"/);
    assert.throws(() => parseAppMeta({ ...seeded, embedding_dim: '1280.0' }), /whole number/);
    assert.throws(() => parseAppMeta({ ...seeded, embedding_dim: '0' }), RangeError);
  });

  test('refuses a non-integer confirm_below', () => {
    assert.throws(() => parseAppMeta({ ...seeded, confirm_below: '12.5' }), /whole number/);
  });
});
