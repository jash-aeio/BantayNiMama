import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Product } from '../../db/products';
import { searchProducts } from '../../domain/productSearch.ts';
import { priceText } from './priceText';
import type { RejectionState } from './useRejection';

// The sheet after No or Wrong? (SR-07, SR-14; P2-3, P2-4), in the panel under the camera so
// the search field is never under the keyboard. Picking a product and *Not in my list* both save the
// next frame, and only if it still shows what was rejected (the capture guard).

const NONE: readonly string[] = [];

interface Props {
  readonly rejection: RejectionState;
  readonly productOf: (id: string) => Product | null;
  /** Live products, for the name search. */
  readonly products: readonly Product[];
}

export const RejectPanel = memo(function RejectPanel({ rejection, productOf, products }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const { state } = rejection;

  const rejected = state.stage === 'idle' ? NONE : state.pinned.productIds;
  const results = useMemo(
    () => searchProducts(products.filter((p) => !rejected.includes(p.id)), query),
    [products, rejected, query],
  );

  if (state.stage === 'idle') return null;

  const names = state.pinned.productIds.map((id) => productOf(id)?.name ?? '—').join(' / ');
  const likely = state.pinned.likelyIds.map(productOf).filter((p): p is Product => p !== null);
  // ADR-022: on chips, the right answer is usually one of the two, so they come first.
  const pair = state.pinned.source === 'wrong_chip' ? state.pinned.productIds.map(productOf).filter((p): p is Product => p !== null) : [];

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t('scan.reject.title')}</Text>
      <Text style={styles.said} numberOfLines={2}>
        {t('scan.reject.appSaid', { names })}
      </Text>

      {state.stage === 'asking' && (
        <>
          <Text style={styles.hint}>{t('scan.reject.correctHint')}</Text>
          {pair.length > 0 && (
            <>
              <Text style={styles.label}>{t('scan.reject.whichOfPair')}</Text>
              {pair.map((p) => (
                <ProductButton key={p.id} product={p} onPress={() => rejection.correct(p.id)} />
              ))}
            </>
          )}
          {likely.length > 0 && (
            <>
              <Text style={styles.label}>{t('scan.reject.likely')}</Text>
              {likely.map((p) => (
                <ProductButton key={p.id} product={p} onPress={() => rejection.correct(p.id)} />
              ))}
            </>
          )}
          <Text style={styles.label}>{t('scan.reject.search')}</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('scan.reject.searchPlaceholder')}
            placeholderTextColor="#7b8794"
            autoCorrect={false}
            style={styles.input}
          />
          {results.map((p) => (
            <ProductButton key={p.id} product={p} onPress={() => rejection.correct(p.id)} />
          ))}
          {query.trim() !== '' && results.length === 0 && <Text style={styles.hint}>{t('scan.reject.noResults')}</Text>}

          <View style={styles.divider} />
          <Text style={styles.body}>{t('scan.reject.notInListHint')}</Text>
          <Button label={t('scan.reject.notInList')} onPress={rejection.notInList} />
          <Button label={t('scan.reject.cancel')} onPress={rejection.close} secondary />
        </>
      )}

      {(state.stage === 'capturing' || state.stage === 'saving') && (
        <View style={styles.busy}>
          <ActivityIndicator color="#ffd166" />
          <Text style={styles.body}>{t(state.stage === 'capturing' ? 'scan.reject.capturing' : 'scan.reject.saving')}</Text>
        </View>
      )}
      {state.stage === 'capturing' && <Button label={t('scan.reject.cancel')} onPress={rejection.close} secondary />}

      {state.stage === 'mismatch' && (
        <>
          <Text style={styles.warning}>{t('scan.reject.mismatch')}</Text>
          <Button label={t('scan.reject.retry')} onPress={rejection.retry} />
          <Button label={t('scan.reject.cancel')} onPress={rejection.close} secondary />
        </>
      )}

      {state.stage === 'failed' && (
        <>
          <Text style={styles.error}>{t('scan.reject.failed', { message: state.message })}</Text>
          <Button label={t('scan.reject.retry')} onPress={rejection.retry} />
          <Button label={t('scan.reject.cancel')} onPress={rejection.close} secondary />
        </>
      )}

      {state.stage === 'saved' && (
        <>
          {state.fix.kind === 'notInList' ? (
            <Text style={styles.ok}>{t('scan.reject.saved')}</Text>
          ) : (
            <CorrectionSaved product={productOf(state.fix.productId)} />
          )}
          <Button label={t('scan.reject.next')} onPress={rejection.close} />
        </>
      )}
    </View>
  );
});

/** The picked product's price, which the helper can now quote: she chose it (PHASE_2_PLAN §4). */
function CorrectionSaved({ product }: { product: Product | null }) {
  const { t } = useTranslation();
  if (product === null) return <Text style={styles.ok}>{t('scan.reject.saved')}</Text>;
  return (
    <>
      <Text style={styles.ok}>{t('scan.reject.correctSaved', { name: product.name })}</Text>
      <Text style={styles.price}>{priceText(product, t)}</Text>
    </>
  );
}

function ProductButton({ product, onPress }: { product: Product; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.product}>
      <Text style={styles.productName} numberOfLines={2}>
        {product.name}
      </Text>
    </Pressable>
  );
}

function Button({ label, onPress, secondary = false }: { label: string; onPress: () => void; secondary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, secondary && styles.secondary]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  said: { color: '#9aa5b1', fontSize: 14 },
  label: { color: '#e6eaef', fontSize: 14, fontWeight: '700' },
  hint: { color: '#9aa5b1', fontSize: 14 },
  body: { color: '#e6eaef', fontSize: 16 },
  input: { backgroundColor: '#1b2430', color: '#ffffff', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 10, fontSize: 16 },
  product: { backgroundColor: '#1b2430', borderRadius: 8, minHeight: 52, justifyContent: 'center', paddingHorizontal: 12 },
  productName: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#1b2430', marginVertical: 4 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  warning: { color: '#ffd166', fontSize: 16 },
  error: { color: '#ff6b6b', fontSize: 16 },
  ok: { color: '#7bd88f', fontSize: 18, fontWeight: '700' },
  price: { color: '#ffd166', fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] },
  button: { backgroundColor: '#2b6cb0', borderRadius: 8, minHeight: 52, justifyContent: 'center', alignItems: 'center' },
  secondary: { backgroundColor: '#1b2430' },
  buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 18 },
});
