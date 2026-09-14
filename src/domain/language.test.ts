import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isLanguage, resolveLanguage } from './language.ts';

describe('resolveLanguage (SR-42)', () => {
  test('a saved choice wins over the phone', () => {
    assert.equal(resolveLanguage('en', ['fil']), 'en');
    assert.equal(resolveLanguage('fil', ['en']), 'fil');
  });

  test('without a choice, follows the first supported phone language', () => {
    assert.equal(resolveLanguage(null, ['fil', 'en']), 'fil');
    assert.equal(resolveLanguage(null, ['en', 'fil']), 'en');
    assert.equal(resolveLanguage(null, ['ja', 'fil']), 'fil');
  });

  test('treats the legacy Tagalog code as Filipino, in any case', () => {
    assert.equal(resolveLanguage(null, ['tl']), 'fil');
    assert.equal(resolveLanguage(null, ['FIL']), 'fil');
  });

  test('falls back to English when nothing matches', () => {
    assert.equal(resolveLanguage(null, []), 'en');
    assert.equal(resolveLanguage(null, [null, 'ja']), 'en');
  });

  test('ignores an unrecognised saved value instead of failing', () => {
    assert.equal(resolveLanguage('klingon', ['fil']), 'fil');
    assert.equal(resolveLanguage('', []), 'en');
  });
});

describe('isLanguage', () => {
  test('accepts only supported codes', () => {
    assert.equal(isLanguage('en'), true);
    assert.equal(isLanguage('fil'), true);
    assert.equal(isLanguage('tl'), false);
    assert.equal(isLanguage(undefined), false);
  });
});
