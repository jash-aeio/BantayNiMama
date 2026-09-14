import { open, type DB } from '@op-engineering/op-sqlite';
import { Paths } from 'expo-file-system';

/** TR-40: one SQLite file holds product metadata and the shot vectors. */
export const DB_FILE = 'bantay.db';

/**
 * Opens a database file in the document directory — `bantay.db` by default, next to `photos/`
 * (TR-46), so the whole catalog stays one file plus one folder for export (SR-45).
 *
 * - The location is explicit: with none, op-sqlite uses Android's `databases/` folder, outside that
 *   layout. A location starting with "/" is used as-is.
 * - Foreign keys are switched on per connection, because SQLite leaves them off by default and a
 *   shot pointing at a missing product would otherwise be accepted.
 * - The journal mode stays SQLite's default rather than WAL: WAL adds `-wal` / `-shm` side files,
 *   and the one-file export layout would then need a checkpoint step before every copy.
 * - op-sqlite's bundled sqlite-vec is switched off (`"sqliteVec": false` in package.json): its
 *   32-bit ARM build cannot load. Vectors are stored as BLOBs and searched in JS (ADR-014).
 */
export function openDatabase(name: string = DB_FILE): DB {
  const db = open({ name, location: documentDirectoryPath() });
  db.executeSync('PRAGMA foreign_keys = ON');
  return db;
}

function documentDirectoryPath(): string {
  // "file:///data/user/0/<package>/files/" → "/data/user/0/<package>/files/"
  return decodeURIComponent(Paths.document.uri.replace(/^file:\/\//, ''));
}
