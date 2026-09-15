// Camera permission, as the tindera sees it — SR-43, gate B1. Pure: the OS status arrives as data.
//
// VisionCamera's four statuses, as its Android code sets them (react-native-vision-camera 5.2):
// - `not-determined`: never asked, or denied once without "don't ask again". The OS prompt can
//   still appear.
// - `denied`: denied with "don't ask again", or twice on Android 11+. Asking again returns false
//   at once and shows nothing, so only system settings can grant it.
// - `restricted`: iOS parental controls. Settings is the only route there too.
// - `authorized`.

export type CameraPermissionStatus = 'not-determined' | 'authorized' | 'denied' | 'restricted';

/**
 * - `granted`: open the camera.
 * - `ask`: explain why, then show the OS prompt on a tap.
 * - `askAgain`: she said no this session, but the OS will still ask. Say plainly that scanning needs
 *   the camera, with the same button.
 * - `openSettings`: the recovery screen. The OS prompt will never appear again, so a button that
 *   asks would do nothing when tapped; this one opens system settings instead.
 */
export type CameraAccessView = 'granted' | 'ask' | 'askAgain' | 'openSettings';

export function cameraAccessView(status: CameraPermissionStatus, deniedThisSession: boolean): CameraAccessView {
  switch (status) {
    case 'authorized':
      return 'granted';
    case 'denied':
    case 'restricted':
      return 'openSettings';
    case 'not-determined':
      return deniedThisSession ? 'askAgain' : 'ask';
  }
}

/**
 * What to write to the interaction log when the status changes, or null. A grant is logged however
 * it arrived: from the OS prompt, or on return from system settings (gate B1).
 */
export function permissionChangeKind(
  previous: CameraPermissionStatus,
  next: CameraPermissionStatus,
): 'cameraGranted' | 'cameraBlocked' | null {
  if (previous === next) return null;
  if (next === 'authorized') return 'cameraGranted';
  if ((next === 'denied' || next === 'restricted') && previous !== 'denied' && previous !== 'restricted') return 'cameraBlocked';
  return null;
}
