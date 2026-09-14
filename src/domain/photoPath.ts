// Photo paths — TR-43. Pure.

/**
 * True for a path that is safe to store: relative to the document directory and unable to point
 * outside it.
 *
 * Absolute paths are rejected because iOS moves the app container on every update, so a stored
 * absolute path breaks silently after an upgrade. `..` segments and backslashes are rejected
 * because a path that can climb out of the document directory is no longer "relative" in any
 * sense that export (TR-46) can rely on.
 */
export function isRelativePhotoPath(path: string): boolean {
  if (path.length === 0 || path.trim() !== path) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false; // file:, content:, C:
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
