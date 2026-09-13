// Schema migration planning — TR-44. Pure: decides which migrations run, and refuses the cases
// where running anything would be a guess.

/**
 * The migration versions to apply, in order, to bring a database at `current` up to date.
 *
 * `available` must be exactly 1..n. A gap would mean a missing migration, and a database that
 * skips one is in a state no code was ever written for.
 *
 * A database NEWER than this app is refused rather than opened. That happens when an older APK
 * is installed over a newer one; its code would read tables whose meaning changed underneath it,
 * so the safe answer is to stop, not to run.
 */
export function planMigrations(current: number, available: readonly number[]): number[] {
  if (!Number.isInteger(current) || current < 0) {
    throw new RangeError(`schema_version must be a non-negative integer, got ${current}`);
  }
  const sorted = [...available].sort((a, b) => a - b);
  sorted.forEach((version, i) => {
    if (version !== i + 1) {
      throw new Error(`Migrations must be numbered 1..n with no gaps or repeats; found ${version} at position ${i + 1}`);
    }
  });
  if (current > sorted.length) {
    throw new Error(
      `Database is at schema_version ${current}, newer than this app's ${sorted.length}. ` +
        'Migrations are forward-only (TR-44), so it is not opened.',
    );
  }
  return sorted.slice(current);
}
