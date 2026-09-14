import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { resolvePhotoPath } from '../../db/photos';
import type { Product, QuickPickProduct } from '../../db/products';
import { confidenceOf, type Confidence } from '../../domain/confidence.ts';
import type { NegativeSource } from '../../domain/correction.ts';
import type { InteractionKind } from '../../domain/interactionLog.ts';
import type { Thresholds } from '../../domain/match.ts';
import { formatCentavos } from '../../domain/money.ts';
import { quickPickTiles } from '../../domain/quickPick.ts';
import { displayFor, type FrameDecision } from '../../domain/scanDisplay.ts';
import { priceText } from './priceText';
import { QuickPickGrid } from './QuickPickGrid';

// The scan card (P2-3), one state per ScanCard (domain/scanDisplay.ts):
// - confirm: photo + "Is this {name}? ₱price" + Yes / No (SR-13);
// - quote: name, price, confidence (SR-02, SR-03) + Wrong?;
// - chips: two choices (SR-09) + Wrong?, whose sheet can teach either of the two (ADR-022);
// - quickPick: the grid of repacked products (SR-10, P2-5), named and priced only after a tile tap;
// - unknown: "Unknown item" + Add (SR-04).
// The pinned grid (gridOpen) shows the same tiles whatever is locked.
//
// The grid has no Wrong? and no *Not in my list*. Nothing on it is named until the tindera taps, so
// there is nothing to correct. A negative saved from a clear bag would sit next to every repacked
// product and silence them too, since a negative outranks ambiguity (resolveFrame).
// It renders only when the locked decision changes, never per frame (SR-12). No and Wrong?
// hand the card's own decision to onReject, which pins it (useRejection).
//
// The price opens the editor (SR-06, P2-4) only where the product is settled: a quote, after Yes, or
// after a chip or tile tap. On the question card it is not tappable, because an edit there would
// land on a product the tindera has not yet agreed it is.

const CONFIDENCE_KEYS = {
  sure: 'scan.confidence.sure',
  likely: 'scan.confidence.likely',
  notSure: 'scan.confidence.notSure',
} as const satisfies Record<Confidence, string>;

const CONFIDENCE_BARS: Record<Confidence, number> = { sure: 3, likely: 2, notSure: 1 };

interface Props {
  readonly locked: FrameDecision | null;
  /** Live products, for confirm mode (TR-38). */
  readonly liveProductCount: number;
  /** app_meta.confirm_below; null means every ACCEPT is a question (ADR-017). */
  readonly confirmBelow: number | null;
  readonly thresholds: Thresholds;
  readonly productOf: (id: string) => Product | null;
  readonly photoOf: (id: string) => string | null;
  /** Live repacked products, for the grid (SR-10). */
  readonly repacked: readonly QuickPickProduct[];
  /** The pinned grid is open: show every repacked product, whatever is locked. */
  readonly gridOpen: boolean;
  readonly onCloseGrid: () => void;
  readonly onAdd: () => void;
  readonly onReject: (locked: FrameDecision, source: NegativeSource) => void;
  /** Opens the price editor bound to this id (SR-06, gate A2). */
  readonly onEditPrice: (productId: string) => void;
  readonly onLog: (kind: InteractionKind, productIds: readonly string[]) => void;
}

export const ScanOverlay = memo(function ScanOverlay({
  locked,
  liveProductCount,
  confirmBelow,
  thresholds,
  productOf,
  photoOf,
  repacked,
  gridOpen,
  onCloseGrid,
  onAdd,
  onReject,
  onEditPrice,
  onLog,
}: Props) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // A chip or tile choice, or a Yes, belongs to the lock it was made on; any new lock clears it. So a
  // Yes shows the price only while the same product stays locked, like a quote. Every grid lock has
  // one stability key, so a tile choice survives clear bags swapping places under the camera.
  useEffect(() => {
    setPicked(null);
    setConfirmed(false);
  }, [locked, gridOpen]);

  const card = useMemo(() => displayFor(locked, liveProductCount, confirmBelow), [locked, liveProductCount, confirmBelow]);

  const pickTile = (productId: string) => {
    onLog('tilePick', [productId]);
    setPicked(productId);
  };

  if (gridOpen) {
    return (
      <GridCard
        title={t('scan.quickPick.pinnedTitle')}
        tiles={quickPickTiles(repacked, [])}
        pickedId={picked}
        onPick={pickTile}
        onEditPrice={onEditPrice}
        onClose={onCloseGrid}
      />
    );
  }

  if (locked === null) return <Scanning />;

  switch (card.kind) {
    case 'scanning':
      return <Scanning />;

    case 'unknown':
      return (
        <View style={[styles.wrap, styles.card]}>
          <Text style={styles.name}>{t('scan.unknown')}</Text>
          <Pressable onPress={onAdd} style={styles.add}>
            <Text style={styles.addText}>{t('scan.add')}</Text>
          </Pressable>
        </View>
      );

    case 'confirm':
    case 'quote': {
      const product = productOf(card.product.productId);
      // A locked id with no live product row should be impossible (TR-45). If it happens, show no
      // price at all rather than a guess.
      if (product === null) return <Scanning />;
      const level = confidenceOf({ kind: 'accept', product: card.product, margin: card.margin }, thresholds);

      if (card.kind === 'confirm' && !confirmed) {
        const photo = photoOf(product.id);
        return (
          <View style={[styles.wrap, styles.card]}>
            <View style={styles.confirmRow}>
              {photo !== null && (
                <Image
                  source={{ uri: `file://${resolvePhotoPath(photo)}` }}
                  style={styles.photo}
                  accessibilityLabel={t('scan.confirm.photoLabel', { name: product.name })}
                />
              )}
              <View style={styles.flex}>
                <Text style={styles.question} numberOfLines={3}>
                  {t('scan.confirm.question', { name: product.name })}
                </Text>
                <Text style={styles.price}>{priceText(product, t)}</Text>
              </View>
            </View>
            {level !== null && <ConfidenceBars level={level} />}
            <View style={styles.answers}>
              <Pressable
                onPress={() => {
                  onLog('confirmYes', [product.id]);
                  setConfirmed(true);
                }}
                style={[styles.answer, styles.yes]}
              >
                <Text style={styles.answerText}>{t('scan.confirm.yes')}</Text>
              </Pressable>
              <Pressable onPress={() => onReject(locked, 'confirm_no')} style={[styles.answer, styles.no]}>
                <Text style={styles.answerText}>{t('scan.confirm.no')}</Text>
              </Pressable>
            </View>
          </View>
        );
      }

      return (
        <View style={[styles.wrap, styles.card]}>
          <PriceBlock product={product} onEdit={onEditPrice} />
          <View style={styles.footer}>
            {level !== null && <ConfidenceBars level={level} />}
            <Pressable onPress={() => onReject(locked, 'wrong_lock')} style={styles.link}>
              <Text style={styles.linkText}>{t('scan.wrong')}</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    case 'chips': {
      const first = productOf(card.first.productId);
      const second = productOf(card.second.productId);
      if (first === null || second === null) return <Scanning />;
      // Only a product from this pair counts, even for the one render before the effect clears it.
      const chosen = [first, second].find((p) => p.id === picked) ?? null;
      return (
        <View style={[styles.wrap, styles.card]}>
          <Text style={styles.question}>{t('scan.whichOne')}</Text>
          <ConfidenceBars level="notSure" />
          <View style={styles.chips}>
            {[first, second].map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  onLog('chipPick', [p.id]);
                  setPicked(p.id);
                }}
                style={[styles.chip, p.id === picked && styles.chipActive]}
              >
                <Text style={[styles.chipText, p.id === picked && styles.chipTextActive]} numberOfLines={2}>
                  {p.name}
                </Text>
              </Pressable>
            ))}
          </View>
          {chosen !== null && <PriceBlock product={chosen} onEdit={onEditPrice} />}
          <Pressable onPress={() => onReject(locked, 'wrong_chip')} style={styles.link}>
            <Text style={styles.linkText}>{t('scan.wrong')}</Text>
          </Pressable>
        </View>
      );
    }

    case 'quickPick': {
      // Every repacked product, plus a non-repacked product the frame chipped with a bag. Nothing is
      // named as a match; a price appears only after a tap (SR-10, ADR-018).
      const involved = card.productIds
        .map(productOf)
        .filter((p): p is Product => p !== null)
        .map((p) => ({ ...p, photoPath: photoOf(p.id) }));
      return (
        <GridCard
          title={t('scan.quickPick.title')}
          tiles={quickPickTiles(repacked, involved)}
          pickedId={picked}
          onPick={pickTile}
          onEditPrice={onEditPrice}
        />
      );
    }
  }
});

function GridCard({
  title,
  tiles,
  pickedId,
  onPick,
  onEditPrice,
  onClose,
}: {
  title: string;
  tiles: readonly QuickPickProduct[];
  pickedId: string | null;
  onPick: (productId: string) => void;
  onEditPrice: (productId: string) => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  // Only a tile on this grid counts, even for the one render before the effect clears the choice.
  const chosen = tiles.find((p) => p.id === pickedId) ?? null;
  return (
    <View style={[styles.wrap, styles.card]}>
      <View style={styles.footer}>
        <Text style={[styles.question, styles.flex]}>{title}</Text>
        {onClose !== undefined && (
          <Pressable onPress={onClose} style={styles.link}>
            <Text style={styles.linkText}>{t('scan.quickPick.close')}</Text>
          </Pressable>
        )}
      </View>
      <QuickPickGrid tiles={tiles} pickedId={pickedId} onPick={onPick} />
      {chosen !== null && <PriceBlock product={chosen} onEdit={onEditPrice} />}
    </View>
  );
}

function Scanning() {
  const { t } = useTranslation();
  return (
    <View style={[styles.wrap, styles.pillWrap]}>
      <Text style={styles.pill}>{t('scan.scanning')}</Text>
    </View>
  );
}

function PriceBlock({ product, onEdit }: { product: Product; onEdit: (productId: string) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      {/* The id is bound here, at tap time; the editor never asks the scanner again (gate A2). */}
      <Pressable onPress={() => onEdit(product.id)} style={styles.priceRow} accessibilityRole="button">
        <Text style={styles.price}>{priceText(product, t)}</Text>
        <Text style={styles.editText}>{t('scan.editPrice')}</Text>
      </Pressable>
      {product.pricePack !== null && (
        <Text style={styles.pack}>{t('scan.pack', { price: formatCentavos(product.pricePack) })}</Text>
      )}
    </>
  );
}

function ConfidenceBars({ level }: { level: Confidence }) {
  const { t } = useTranslation();
  const label = t(CONFIDENCE_KEYS[level]);
  return (
    <View style={styles.confidence} accessibilityLabel={label}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.bar, i < CONFIDENCE_BARS[level] && styles[level]]} />
      ))}
      <Text style={styles.confidenceText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, bottom: 12 },
  card: { backgroundColor: 'rgba(11, 15, 20, 0.9)', borderRadius: 10, padding: 14, gap: 8 },
  pillWrap: { alignItems: 'center' },
  pill: {
    color: '#e6eaef',
    backgroundColor: 'rgba(11, 15, 20, 0.75)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  flex: { flex: 1, gap: 4 },
  name: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  price: { color: '#ffd166', fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editText: { color: '#9ec5fe', fontSize: 16, fontWeight: '700', paddingVertical: 8 },
  pack: { color: '#e6eaef', fontSize: 16, fontVariant: ['tabular-nums'] },
  question: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  confirmRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  photo: { width: 96, height: 96, borderRadius: 8, backgroundColor: '#1b2430' },
  answers: { flexDirection: 'row', gap: 10 },
  answer: { flex: 1, minHeight: 60, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  yes: { backgroundColor: '#2f855a' },
  no: { backgroundColor: '#9b2c2c' },
  answerText: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4 },
  linkText: { color: '#9ec5fe', fontSize: 16, fontWeight: '700' },
  confidence: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bar: { width: 18, height: 8, borderRadius: 2, backgroundColor: '#3a4655' },
  sure: { backgroundColor: '#7bd88f' },
  likely: { backgroundColor: '#ffd166' },
  notSure: { backgroundColor: '#ff9f43' },
  confidenceText: { color: '#e6eaef', fontSize: 14, marginLeft: 6 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, backgroundColor: '#1b2430', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 10 },
  chipActive: { backgroundColor: '#ffd166' },
  chipText: { color: '#ffffff', fontWeight: '600', textAlign: 'center' },
  chipTextActive: { color: '#0b0f14' },
  add: { backgroundColor: '#2b6cb0', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  addText: { color: '#ffffff', fontWeight: '700', fontSize: 18 },
});
