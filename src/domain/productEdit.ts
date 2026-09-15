// Editing a product from the Directory — SR-31. Pure.
//
// The form is enrollment's (SR-21) plus the *repacked* flag (SR-10), and it is parsed by the same
// rules, so a product can never be saved by one screen and refused by the other.

import { parseEnrollmentForm, type EnrollmentForm, type FormError } from './enrollment.ts';
import { priceFormOf, type StoredPrices } from './priceEdit.ts';

/** Everything but the prices. Prices go through price_history (ADR-021); these do not. */
export interface ProductDetails {
  readonly name: string;
  readonly unitLabel: string | null;
  readonly category: string | null;
  readonly isAmbiguous: boolean;
}

export interface EditableProduct extends StoredPrices, ProductDetails {}

export interface ProductForm extends EnrollmentForm {
  readonly isAmbiguous: boolean;
}

export type ProductEdit =
  | { readonly kind: 'invalid'; readonly errors: readonly FormError[] }
  /** Write nothing. */
  | { readonly kind: 'unchanged' }
  /**
   * One transaction (db/products.updateProduct). `prices` is null when they did not change, so no
   * price_history row is written for an edit that only renamed the product.
   */
  | {
      readonly kind: 'change';
      readonly details: ProductDetails;
      readonly prices: { readonly pricePiece: number; readonly pricePack: number | null } | null;
    };

/** The editor's starting text. Whatever it returns, planProductEdit reads back as `unchanged`. */
export function productFormOf(product: EditableProduct): ProductForm {
  return {
    name: product.name,
    ...priceFormOf(product),
    unitLabel: product.unitLabel ?? '',
    category: product.category ?? '',
    isAmbiguous: product.isAmbiguous,
  };
}

/**
 * SR-31. Fields compare after enrollment's parsing: the name trimmed, a blank unit or category as
 * none, and prices as centavos. So "12.5" over a stored 1250, or a trailing space after the name, is
 * `unchanged`, and opening the editor to look and saving writes nothing.
 */
export function planProductEdit(current: EditableProduct, form: ProductForm): ProductEdit {
  const parsed = parseEnrollmentForm(form);
  if (!parsed.ok) return { kind: 'invalid', errors: parsed.errors };
  const { name, unitLabel, category, pricePiece, pricePack } = parsed.product;

  const details: ProductDetails = { name, unitLabel, category, isAmbiguous: form.isAmbiguous };
  const detailsChanged =
    name !== current.name ||
    unitLabel !== current.unitLabel ||
    category !== current.category ||
    form.isAmbiguous !== current.isAmbiguous;
  const pricesChanged = pricePiece !== current.pricePiece || pricePack !== current.pricePack;

  if (!detailsChanged && !pricesChanged) return { kind: 'unchanged' };
  return { kind: 'change', details, prices: pricesChanged ? { pricePiece, pricePack } : null };
}
