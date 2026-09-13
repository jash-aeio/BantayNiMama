import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isRelativePhotoPath } from './photoPath.ts';
import { REFERENCE_MAX_SIDE, referencePhotoPath, referenceSide } from './referencePhoto.ts';

describe('referencePhotoPath (TR-43)', () => {
  test('puts one relative file per shot in photos/', () => {
    const path = referencePhotoPath('0b8e7c1a-3f2d-4e5a-9b6c-7d8e9f0a1b2c');
    assert.equal(path, 'photos/0b8e7c1a-3f2d-4e5a-9b6c-7d8e9f0a1b2c.jpg');
    assert.equal(isRelativePhotoPath(path), true);
  });

  test('refuses an id that could escape or break the file name', () => {
    for (const bad of ['', '../x', 'a/b', 'a\\b', 'shot.jpg', 'shot id']) {
      assert.throws(() => referencePhotoPath(bad), /usable shot id/, JSON.stringify(bad));
    }
  });
});

describe('referenceSide (TR-42, NFR-08)', () => {
  test('caps a large crop at 512 px', () => {
    assert.equal(referenceSide(1080), REFERENCE_MAX_SIDE);
    assert.equal(referenceSide(512), 512);
  });

  test('never upscales a smaller crop', () => {
    // 0.55 of a 720 px frame edge.
    assert.equal(referenceSide(396), 396);
  });

  test('refuses a nonsense crop side', () => {
    assert.throws(() => referenceSide(0), RangeError);
    assert.throws(() => referenceSide(395.5), RangeError);
    assert.throws(() => referenceSide(NaN), RangeError);
  });
});
