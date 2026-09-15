import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';

import { cameraAccessView, permissionChangeKind, type CameraAccessView } from '../../domain/cameraAccess.ts';
import type { InteractionKind } from '../../domain/interactionLog.ts';

export interface CameraAccess {
  readonly hasPermission: boolean;
  readonly view: CameraAccessView;
  /** Shows the OS prompt. Offered only while the OS can still show it (`ask`, `askAgain`). */
  ask(): void;
  /**
   * SR-43: system settings, through React Native core's Linking.openSettings(). It opens a system
   * screen, not a network connection (TR-50).
   */
  openSettings(): void;
}

/**
 * The camera permission as a view (domain/cameraAccess.ts), with every step written to the
 * interaction log for gate B1.
 *
 * VisionCamera's hook re-reads the status whenever the app becomes active again, so a grant made in
 * system settings arrives here on return, with no polling. Mount this once per screen that decides
 * whether the camera opens, so that screen sees the same status it logs.
 */
export function useCameraAccess(log: (kind: InteractionKind, productIds: readonly string[]) => void): CameraAccess {
  const { status, hasPermission, requestPermission } = useCameraPermission();
  const [deniedThisSession, setDeniedThisSession] = useState(false);
  const previous = useRef(status);
  const asking = useRef(false);

  useEffect(() => {
    const kind = permissionChangeKind(previous.current, status);
    previous.current = status;
    if (kind !== null) log(kind, []);
  }, [status, log]);

  const ask = useCallback(() => {
    // One prompt at a time: a double tap would queue a second request behind the first dialog.
    if (asking.current) return;
    asking.current = true;
    log('cameraAsk', []);
    const denied = () => {
      setDeniedThisSession(true);
      log('cameraDenied', []);
    };
    requestPermission()
      .then((granted) => {
        if (!granted) denied();
      }, denied)
      .finally(() => {
        asking.current = false;
      });
  }, [log, requestPermission]);

  const openSettings = useCallback(() => {
    log('cameraOpenSettings', []);
    void Linking.openSettings();
  }, [log]);

  return { hasPermission, view: cameraAccessView(status, deniedThisSession), ask, openSettings };
}
