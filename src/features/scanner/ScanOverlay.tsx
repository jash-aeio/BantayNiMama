import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Product } from '../../db/products';
import { confidenceOf, type Confidence } from '../../domain/confidence.ts';
import type { Decision, Thresholds } from '../../domain/match.ts';
import { formatCentavos } from '../../domain/money.ts';

// P1-6 scan overlay: LOCK → name, price, confidence (SR-02, SR-03) · CHIPS → two choices (SR-09) ·
// UNKNOWN → "Unknown item" + Add (SR-04). Plain RN views. It renders only when the locked decision
// changes, never per frame (SR-12); Reanimated arrives in Phase 2 (TR-18).

const CONFIDENCE_KEYS = {
  sure: 'scan.confidence.sure',
  likely: 'scan.confidence.likely',
  notSure: 'scan.confidence.notSure',
} as const satisfies Record<Confidence, string>;

const CONFIDENCE_BARS: Record<Confidence, number> = { sure: 3, likely: 2, notSure: 1 };

interface Props {
  readonly locked: Decision | null;
  readonly thresholds: Thresholds;
  readonly productOf: (id: string) => Product | null;
  readonly onAdd: () => void;
}

export const ScanOverlay = memo(function ScanOverlay({ locked, thresholds, productOf, onAdd }: Props) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);

  // A chip choice belongs to the pair it was made on; any new lock clears it.
  useEffect(() => {
    setPicked(null);
  }, [locked]);

  if (locked === null) return <Scanning />;

  switch (locked.kind) {
    case 'unknown':
      return (
        <View style={[styles.wrap, styles.card]}>
          <Text style={styles.name}>{t('scan.unknown')}</Text>
          <Pressable onPress={onAdd} style={styles.add}>
            <Text style={styles.addText}>{t('scan.add')}</Text>
          </Pressable>
        </View>
      );

    case 'accept': {
      const product = productOf(locked.product.productId);
      // A locked id with no live product row should be impossible (TR-45). If it happens, show no
      // price at all rather than a guess.
      if (product === null) return <Scanning />;
      const level = confidenceOf(locked, thresholds);
      return (
        <View style={[styles.wrap, styles.card]}>
          <PriceBlock product={product} />
          {level !== null && <ConfidenceBars level={level} />}
        </View>
      );
    }

    case 'disambiguate': {
      const first = productOf(locked.first.productId);
      const second = productOf(locked.second.productId);
      if (first === null || second === null) return <Scanning />;
      // Only a product from this pair counts, even for the one render before the effect clears it.
      const chosen = [first, second].find((p) => p.id === picked) ?? null;
      return (
        <View style={[styles.wrap, styles.card]}>
          <Text style={styles.question}>{t('scan.whichOne')}</Text>
          <ConfidenceBars level="notSure" />
          <View style={styles.chips}>
            {[first, second].map((p) => (
              <Pressable key={p.id} onPress={() => setPicked(p.id)} style={[styles.chip, p.id === picked && styles.chipActive]}>
                <Text style={[styles.chipText, p.id === picked && styles.chipTextActive]} numberOfLines={2}>
                  {p.name}
                </Text>
              </Pressable>
            ))}
          </View>
          {chosen !== null && <PriceBlock product={chosen} />}
        </View>
      );
    }
  }
});

function Scanning() {
  const { t } = useTranslation();
  return (
    <View style={[styles.wrap, styles.pillWrap]}>
      <Text style={styles.pill}>{t('scan.scanning')}</Text>
    </View>
  );
}

function PriceBlock({ product }: { product: Product }) {
  const { t } = useTranslation();
  const price = product.pricePiece === null ? null : formatCentavos(product.pricePiece);
  return (
    <>
      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      <Text style={styles.price}>
        {price === null
          ? t('scan.noPrice')
          : product.unitLabel === null
            ? price
            : t('scan.perUnit', { price, unit: product.unitLabel })}
      </Text>
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
  card: { backgroundColor: 'rgba(11, 15, 20, 0.9)', borderRadius: 10, padding: 14, gap: 6 },
  pillWrap: { alignItems: 'center' },
  pill: {
    color: '#e6eaef',
    backgroundColor: 'rgba(11, 15, 20, 0.75)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  name: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  price: { color: '#ffd166', fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] },
  pack: { color: '#e6eaef', fontSize: 16, fontVariant: ['tabular-nums'] },
  question: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
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
