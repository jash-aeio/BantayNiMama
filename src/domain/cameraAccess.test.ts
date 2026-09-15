import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cameraAccessView, permissionChangeKind, type CameraPermissionStatus } from './cameraAccess.ts';

describe('cameraAccessView (SR-43)', () => {
  test('authorized opens the camera, whatever happened before', () => {
    assert.equal(cameraAccessView('authorized', false), 'granted');
    assert.equal(cameraAccessView('authorized', true), 'granted');
  });

  test('never asked: explain, then ask', () => {
    assert.equal(cameraAccessView('not-determined', false), 'ask');
  });

  test('denied once, still askable: ask again with the plain reason', () => {
    assert.equal(cameraAccessView('not-determined', true), 'askAgain');
  });

  test('blocked or restricted: the recovery screen, never a button that asks', () => {
    for (const denied of [false, true]) {
      assert.equal(cameraAccessView('denied', denied), 'openSettings');
      assert.equal(cameraAccessView('restricted', denied), 'openSettings');
    }
  });
});

describe('permissionChangeKind (gate B1 evidence)', () => {
  const statuses: CameraPermissionStatus[] = ['not-determined', 'authorized', 'denied', 'restricted'];

  test('no change logs nothing', () => {
    for (const s of statuses) assert.equal(permissionChangeKind(s, s), null, s);
  });

  test('a grant is logged from any earlier status, including on return from settings', () => {
    assert.equal(permissionChangeKind('not-determined', 'authorized'), 'cameraGranted');
    assert.equal(permissionChangeKind('denied', 'authorized'), 'cameraGranted');
  });

  test('becoming blocked is logged once, not again between denied and restricted', () => {
    assert.equal(permissionChangeKind('not-determined', 'denied'), 'cameraBlocked');
    assert.equal(permissionChangeKind('authorized', 'denied'), 'cameraBlocked');
    assert.equal(permissionChangeKind('denied', 'restricted'), null);
  });

  test('falling back to askable logs nothing', () => {
    assert.equal(permissionChangeKind('denied', 'not-determined'), null);
    assert.equal(permissionChangeKind('authorized', 'not-determined'), null);
  });
});
