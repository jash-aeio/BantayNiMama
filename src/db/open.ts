import { open, type DB } from '@op-engineering/op-sqlite';
import { Paths } from 'expo-file-system';

/** TR-40: one SQLite file holds product metadata and the vec0 table. */
export const DB_FILE = 'bantay.db';

/**
 * Opens `bantay.db` in the document directory, next to `photos/` (TR-46), so the whole
 * catalog stays one file plus one folder for export (SR-45).
 *
 * The location is passed explicitly: with none, op-sqlite uses Android's `databases/` folder,
 * outside that layout. A location starting with "/" is used as-is.
 *
 * op-sqlite's bundled sqlite-vec is switched off (`"sqliteVec": false` in package.json): its
 * 32-bit ARM build cannot load, and with it on, open() throws before SQLite is usable at all
 * (CHANGELOG, P1-2). Vectors are stored as BLOBs and searched in JS instead (ADR-014).
 */
export function openDatabase(): DB {
  return open({ name: DB_FILE, location: documentDirectoryPath() });
}

function documentDirectoryPath(): string {
  // "file:///data/user/0/<package>/files/" → "/data/user/0/<package>/files/"
  return decodeURIComponent(Paths.document.uri.replace(/^file:\/\//, ''));
}
