import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isRelativePhotoPath } from './photoPath.ts';

describe('isRelativePhotoPath (TR-43)', () => {
  test('accepts paths relative to the document directory', () => {
    assert.equal(isRelativePhotoPath('photos/0b8e7c1a.jpg'), true);
    assert.equal(isRelativePhotoPath('photos/p1/s2.jpg'), true);
  });

  test('rejects absolute paths and URIs — they break after an iOS app update', () => {
    for (const bad of [
      '/data/user/0/com.jash.bantaynimama/files/photos/a.jpg',
      'file:///data/user/0/com.jash.bantaynimama/files/photos/a.jpg',
      'content://media/external/images/1',
      'C:/photos/a.jpg',
    ]) {
      assert.equal(isRelativePhotoPath(bad), false, bad);
    }
  });

  test('rejects paths that could escape the document directory', () => {
    for (const bad of ['../photos/a.jpg', 'photos/../../a.jpg', 'photos\\a.jpg', 'photos//a.jpg', './photos/a.jpg']) {
      assert.equal(isRelativePhotoPath(bad), false, bad);
    }
  });

  test('rejects empty or padded paths', () => {
    assert.equal(isRelativePhotoPath(''), false);
    assert.equal(isRelativePhotoPath(' photos/a.jpg'), false);
  });
});
