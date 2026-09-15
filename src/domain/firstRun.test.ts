import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MAX_SHOTS } from './enrollment.ts';
import {
  afterGuidedSave,
  FIRST_RUN_DISMISSED_VALUE,
  FIRST_RUN_INTRO_AT_CAMERA,
  firstRunState,
  introStartStep,
  nextShotAngle,
  SHOT_ANGLES,
} from './firstRun.ts';

describe('firstRunState (SR-44)', () => {
  test('an empty catalog, never dismissed, opens the welcome flow', () => {
    assert.deepEqual(firstRunState(0, null), { kind: 'welcome' });
  });

  test('"Finish later" on an empty catalog leaves the 0 of 5 banner', () => {
    assert.deepEqual(firstRunState(0, FIRST_RUN_DISMISSED_VALUE), { kind: 'banner', done: 0, target: 5 });
  });

  test('a flow left part-way resumes as the banner, dismissed or not', () => {
    assert.deepEqual(firstRunState(2, null), { kind: 'banner', done: 2, target: 5 });
    assert.deepEqual(firstRunState(4, FIRST_RUN_DISMISSED_VALUE), { kind: 'banner', done: 4, target: 5 });
  });

  test('five products complete it; deleting back below five brings the banner back', () => {
    assert.deepEqual(firstRunState(5, null), { kind: 'complete' });
    assert.deepEqual(firstRunState(40, FIRST_RUN_DISMISSED_VALUE), { kind: 'complete' });
    assert.deepEqual(firstRunState(4, null), { kind: 'banner', done: 4, target: 5 });
  });

  test('an unrecognised saved value counts as not dismissed, and never throws', () => {
    for (const saved of ['', 'true', '0', ' 1']) assert.deepEqual(firstRunState(0, saved), { kind: 'welcome' }, saved);
  });

  test('refuses a count that is not a whole, non-negative number', () => {
    for (const n of [NaN, -1, 2.5]) assert.throws(() => firstRunState(n, null), RangeError, String(n));
  });
});

describe('introStartStep (SR-43, P2-6 device attempt 1)', () => {
  test('a first launch opens the welcome', () => {
    assert.equal(introStartStep(null), 'welcome');
  });

  test('a relaunch after the intro reached the camera step resumes there, not at the welcome', () => {
    assert.equal(introStartStep(FIRST_RUN_INTRO_AT_CAMERA), 'camera');
  });

  test('an unrecognised saved value opens the welcome, and never throws', () => {
    for (const saved of ['', 'language', 'CAMERA', ' camera']) assert.equal(introStartStep(saved), 'welcome', saved);
  });
});

describe('nextShotAngle (SR-20)', () => {
  test('one distinct prompt per photo, as many as enrollment allows', () => {
    assert.equal(SHOT_ANGLES.length, MAX_SHOTS);
    assert.equal(new Set(SHOT_ANGLES).size, SHOT_ANGLES.length);
    assert.deepEqual(
      Array.from({ length: MAX_SHOTS }, (_, i) => nextShotAngle(i)),
      [...SHOT_ANGLES],
    );
  });

  test('no prompt once the cap is reached', () => {
    assert.equal(nextShotAngle(MAX_SHOTS), null);
    assert.equal(nextShotAngle(MAX_SHOTS + 3), null);
  });

  test('refuses a count that is not a whole, non-negative number', () => {
    for (const n of [NaN, -1, 1.5]) assert.throws(() => nextShotAngle(n), RangeError, String(n));
  });
});

describe('afterGuidedSave (SR-44)', () => {
  test('the first product suggests trying the scanner on it', () => {
    assert.equal(afterGuidedSave(1), 'tryScanning');
  });

  test('two to four ask for the next product', () => {
    for (const n of [2, 3, 4]) assert.equal(afterGuidedSave(n), 'next', String(n));
  });

  test('five or more complete the flow', () => {
    assert.equal(afterGuidedSave(5), 'complete');
    assert.equal(afterGuidedSave(9), 'complete');
  });

  test('refuses zero, which no save can leave, and bad counts', () => {
    for (const n of [0, -1, 2.5]) assert.throws(() => afterGuidedSave(n), RangeError, String(n));
  });
});
