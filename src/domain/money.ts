// Money as integer centavos — TR-41, ADR-007. ₱12.50 is 1250.
// Parsing works on the typed digits and never passes through a float; formatting happens
// only at the render boundary.

const PESO_SIGN = '₱';
const PLAIN = /^(\d+)(?:\.(\d{1,2}))?$/;
const GROUPED = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

/**
 * Parse what a tindera types into centavos: "12.50", "12.5", "12", "₱1,250.00".
 *
 * Returns null for anything else — including a third decimal place, which would have to be
 * rounded, and a price should never be rounded without the person who typed it seeing it.
 */
export function parsePesos(input: string): number | null {
  let s = input.trim();
  if (s.startsWith(PESO_SIGN)) s = s.slice(PESO_SIGN.length).trimStart();

  const m = PLAIN.exec(s) ?? GROUPED.exec(s);
  if (m === null) return null;

  const pesos = Number(m[1]!.replace(/,/g, ''));
  const centavos = Number((m[2] ?? '').padEnd(2, '0'));
  const total = pesos * 100 + centavos;
  return Number.isSafeInteger(total) ? total : null;
}

/** Render centavos as "₱1,250.00". The only place money becomes text (ADR-007). */
export function formatCentavos(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos < 0) {
    throw new RangeError(`Centavos must be a non-negative safe integer, got ${centavos}`);
  }
  const cents = centavos % 100;
  const pesos = (centavos - cents) / 100; // exact: the dividend is a multiple of 100
  const grouped = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${PESO_SIGN}${grouped}.${String(cents).padStart(2, '0')}`;
}
