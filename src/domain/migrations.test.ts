import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { planMigrations } from './migrations.ts';

describe('planMigrations (TR-44)', () => {
  test('a fresh database runs every migration in order', () => {
    assert.deepEqual(planMigrations(0, [2, 1, 3]), [1, 2, 3]);
  });

  test('a database part-way runs only what it is missing', () => {
    assert.deepEqual(planMigrations(1, [1, 2, 3]), [2, 3]);
  });

  test('an up-to-date database runs nothing', () => {
    assert.deepEqual(planMigrations(3, [1, 2, 3]), []);
  });

  test('refuses a database newer than the app instead of guessing', () => {
    assert.throws(() => planMigrations(4, [1, 2, 3]), /newer than this app/);
  });

  test('refuses a gap or repeat in the migration list', () => {
    assert.throws(() => planMigrations(0, [1, 3]), /no gaps or repeats/);
    assert.throws(() => planMigrations(0, [1, 1]), /no gaps or repeats/);
  });

  test('refuses a nonsense schema_version', () => {
    assert.throws(() => planMigrations(-1, [1]), RangeError);
    assert.throws(() => planMigrations(1.5, [1, 2]), RangeError);
    assert.throws(() => planMigrations(NaN, [1]), RangeError);
  });
});
