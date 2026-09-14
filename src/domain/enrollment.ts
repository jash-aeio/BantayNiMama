// Enrollment rules — SR-20, SR-21, SR-23. Pure: the form arrives as the text the tindera typed,
// and the duplicate check receives KNN rows the caller has already fetched.

import { assertThresholds, rankProducts, type ProductScore, type ShotMatch, type Thresholds } from './match.ts';
import { parsePrices, type PriceError } from './priceEdit.ts';

/** SR-20 asks for 3–5 reference photos; TR-42 caps enrollment at 5 (corrections add up to 3, correction.ts). */
export const MIN_SHOTS = 3;
export const MAX_SHOTS = 5;

export interface NewProduct {
  readonly name: string;
  /** Whole centavos (TR-41). */
  readonly pricePiece: number;
  readonly pricePack: number | null;
  readonly unitLabel: string | null;
  readonly category: string | null;
}

/** The form exactly as typed. Nothing is parsed until parseEnrollmentForm. */
export interface EnrollmentForm {
  readonly name: string;
  readonly pricePiece: string;
  readonly pricePack: string;
  readonly unitLabel: string;
  readonly category: string;
}

export type FormError = 'nameRequired' | PriceError;

export type ParsedForm =
  | { readonly ok: true; readonly product: NewProduct }
  | { readonly ok: false; readonly errors: readonly FormError[] };

/**
 * SR-21: name and per-piece price are required; pack price, unit and category are optional.
 *
 * Prices follow parsePrices, the same rules as a price edit (SR-06): "12.50" becomes 1250 without
 * touching a float (TR-41), and ₱0.00 is refused. Every error is returned at once, so the form can
 * mark all bad fields in one pass.
 */
export function parseEnrollmentForm(form: EnrollmentForm): ParsedForm {
  const errors: FormError[] = [];

  const name = form.name.trim();
  if (name === '') errors.push('nameRequired');

  const prices = parsePrices(form);
  if (!prices.ok) errors.push(...prices.errors);

  if (!prices.ok || errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    product: {
      name,
      pricePiece: prices.pricePiece,
      pricePack: prices.pricePack,
      unitLabel: optionalText(form.unitLabel),
      category: optionalText(form.category),
    },
  };
}

/**
 * SR-23: catalog products that the new shots already resemble, best first.
 *
 * `hitsPerShot` holds one KNN result per captured shot. A product counts when its best score over
 * all of those shots reaches τ. That is the same bar at which the scanner would start naming it
 * (TR-32, TR-33), so a warning here means "the scanner could confuse these".
 *
 * It is a warning, not a block. A size variant (L-02) legitimately looks like its sibling, and the
 * tindera is the one who knows whether it is the same product.
 */
export function likelyDuplicates(
  hitsPerShot: readonly (readonly ShotMatch[])[],
  thresholds: Thresholds,
): ProductScore[] {
  assertThresholds(thresholds);
  return rankProducts(hitsPerShot.flat()).filter((p) => p.score >= thresholds.tau);
}

function optionalText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}
