/**
 * A random UUID v4 for product and shot ids.
 *
 * Ids need to be unique, not unpredictable — nobody gains anything by guessing a shot id on a
 * phone with no network — so Math.random is enough, and it avoids adding a native crypto module
 * to audit (TR-51). This is the one impure helper the id-generating repositories share.
 */
export function newId(): string {
  const hex = (length: number) =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16); // 10xx — RFC 4122
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}
