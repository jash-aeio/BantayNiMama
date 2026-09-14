import { useCallback, useEffect, useRef, useState } from 'react';

import type { IndexRebuildReason } from '../../app/services';
import type { Catalog } from '../../db/catalog';
import { getProduct, restoreProduct, softDeleteProduct } from '../../db/products';
import type { InteractionKind } from '../../domain/interactionLog.ts';
import { canUndoDelete, UNDO_WINDOW_MS } from '../../domain/trash.ts';

// Delete from the scan card, with undo — SR-08, SR-32; P2-4. A soft delete: the rows and photos stay
// for restore (TR-24), and the index is rebuilt without the product (E-4).

export interface PendingUndo {
  readonly productId: string;
  readonly name: string;
  /** The `deleted_at` written, epoch ms. */
  readonly deletedAt: number;
}

export interface UndoDeleteState {
  /** The last delete, while its 10 s undo window is open. */
  readonly pending: PendingUndo | null;
  /** The index could not be rebuilt after a delete or undo. */
  readonly rebuildError: string | null;
  /** Returns false, doing nothing, when there was no live product to delete. */
  remove(productId: string): boolean;
  undo(): void;
  dismissError(): void;
}

interface Options {
  readonly catalog: Catalog;
  readonly rebuildIndex: (reason: IndexRebuildReason) => unknown;
  readonly onCatalogChanged: () => void;
  readonly log: (kind: InteractionKind, productIds: readonly string[]) => void;
}

export function useUndoDelete({ catalog, rebuildIndex, onCatalogChanged, log }: Options): UndoDeleteState {
  const [pending, setPendingState] = useState<PendingUndo | null>(null);
  // The timer and Undo can race; both read the ref, so neither acts on a delete the other finished.
  const pendingRef = useRef<PendingUndo | null>(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);

  const setPending = useCallback((next: PendingUndo | null) => {
    pendingRef.current = next;
    setPendingState(next);
  }, []);

  /**
   * If the rebuild fails, the old index still holds the product's rows. They cannot put a price on
   * screen, because the card reads the product through getProduct, which skips the trash and falls
   * back to "scanning". But the scanner is wrong until a relaunch, so say so.
   */
  const rebuild = useCallback(
    (reason: IndexRebuildReason) => {
      try {
        rebuildIndex(reason);
        setRebuildError(null);
      } catch (e) {
        setRebuildError(e instanceof Error ? e.message : String(e));
      }
      onCatalogChanged();
    },
    [rebuildIndex, onCatalogChanged],
  );

  const remove = useCallback(
    (productId: string) => {
      const product = getProduct(catalog.db, productId);
      if (product === null) return false;
      const now = Date.now();
      if (!softDeleteProduct(catalog.db, productId, now)) return false;
      log('delete', [productId]);
      setPending({ productId, name: product.name, deletedAt: now });
      rebuild('delete');
      return true;
    },
    [catalog, log, rebuild, setPending],
  );

  const undo = useCallback(() => {
    const current = pendingRef.current;
    if (current === null) return;
    setPending(null);
    // Past the window the product stays in the trash, where it can still be restored (SR-32).
    if (!canUndoDelete(current.deletedAt, Date.now())) return;
    if (!restoreProduct(catalog.db, current.productId)) return;
    log('undo', [current.productId]);
    rebuild('undo');
  }, [catalog, log, rebuild, setPending]);

  // One timer per delete. A second delete replaces the bar; the first product simply stays in the trash.
  useEffect(() => {
    if (pending === null) return;
    const remaining = Math.max(0, UNDO_WINDOW_MS - (Date.now() - pending.deletedAt));
    const timer = setTimeout(() => {
      if (pendingRef.current !== pending) return;
      log('undoLapsed', [pending.productId]);
      setPending(null);
    }, remaining);
    return () => clearTimeout(timer);
  }, [pending, log, setPending]);

  const dismissError = useCallback(() => setRebuildError(null), []);

  return { pending, rebuildError, remove, undo, dismissError };
}
