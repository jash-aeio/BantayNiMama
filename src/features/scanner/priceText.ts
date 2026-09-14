import type { useTranslation } from 'react-i18next';

import type { Product } from '../../db/products';
import { formatCentavos } from '../../domain/money.ts';

type T = ReturnType<typeof useTranslation>['t'];

/** The per-piece price as the scan card shows it: "₱12.50", "₱12.50 / sachet", or "No price yet" (SR-02). */
export function priceText(product: Product, t: T): string {
  const price = product.pricePiece === null ? null : formatCentavos(product.pricePiece);
  if (price === null) return t('scan.noPrice');
  return product.unitLabel === null ? price : t('scan.perUnit', { price, unit: product.unitLabel });
}
