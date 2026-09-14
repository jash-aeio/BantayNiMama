// Prices as typed — SR-06, SR-21, TR-41. Pure. Enrollment and price edits (from the scan card or
// the Directory) share these rules, so a price can never be accepted by one and refused by the other.

import { parsePesos } from './money.ts';

export type PriceError = 'piecePriceRequired' | 'piecePriceInvalid' | 'packPriceInvalid';

/** The two price fields exactly as typed: *tingi* (per piece) and *buo* (per pack). */
export interface PriceForm {
  readonly pricePiece: string;
  readonly pricePack: string;
}

export type ParsedPrices =
  | { readonly ok: true; readonly pricePiece: number; readonly pricePack: number | null }
  | { readonly ok: false; readonly errors: readonly PriceError[] };

/**
 * The per-piece price is required; a blank pack price means none.
 *
 * Both go through parsePesos, so "12.50" becomes 1250 without touching a float (TR-41). A price of
 * zero is refused: nothing on a sari-sari shelf is free, so ₱0.00 is a typo, and quoting it
 * confidently would cost the store money (NFR-02). Every error is returned at once.
 */
export function parsePrices(form: PriceForm): ParsedPrices {
  const errors: PriceError[] = [];

  let pricePiece: number | null = null;
  if (form.pricePiece.trim() === '') {
    errors.push('piecePriceRequired');
  } else {
    pricePiece = positiveCentavos(form.pricePiece);
    if (pricePiece === null) errors.push('piecePriceInvalid');
  }

  let pricePack: number | null = null;
  if (form.pricePack.trim() !== '') {
    pricePack = positiveCentavos(form.pricePack);
    if (pricePack === null) errors.push('packPriceInvalid');
  }

  if (errors.length > 0 || pricePiece === null) return { ok: false, errors };
  return { ok: true, pricePiece, pricePack };
}

/** A product's prices as stored. `price_piece` is nullable in schema v1, so a missing one can be filled in. */
export interface StoredPrices {
  readonly pricePiece: number | null;
  readonly pricePack: number | null;
}

export type PriceEdit =
  | { readonly kind: 'invalid'; readonly errors: readonly PriceError[] }
  /** Write nothing. */
  | { readonly kind: 'unchanged' }
  /** One UPDATE plus one `price_history` row, in one transaction (P2-2). */
  | { readonly kind: 'change'; readonly pricePiece: number; readonly pricePack: number | null };

/**
 * SR-06. An edit that lands on the stored prices is `unchanged` and writes nothing: no UPDATE and no
 * `price_history` row. Opening the editor to check a price and saving is not a price change, and a
 * history full of non-changes would hide the real ones. Prices compare as centavos, never as text,
 * so "12.5" over a stored 1250 is unchanged.
 */
export function planPriceEdit(current: StoredPrices, form: PriceForm): PriceEdit {
  const prices = parsePrices(form);
  if (!prices.ok) return { kind: 'invalid', errors: prices.errors };
  if (prices.pricePiece === current.pricePiece && prices.pricePack === current.pricePack) return { kind: 'unchanged' };
  return { kind: 'change', pricePiece: prices.pricePiece, pricePack: prices.pricePack };
}

function positiveCentavos(text: string): number | null {
  const centavos = parsePesos(text);
  return centavos !== null && centavos > 0 ? centavos : null;
}
