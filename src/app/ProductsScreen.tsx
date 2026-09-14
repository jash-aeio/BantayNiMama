import { useIsFocused } from '@react-navigation/native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { listProducts, type ProductListItem } from '../db/products';
import { LANGUAGES, type Language } from '../domain/language.ts';
import { formatCentavos } from '../domain/money.ts';
import { TrashList } from '../features/directory/TrashList';
import { GateCheckPanel } from '../features/gate/GateCheckPanel';
import { useAppServices } from './services';

// The Products tab: a plain list read from SQLite, for checking the catalog (P1-7). It is not
// SR-30's directory — search, edit and delete arrive in Phase 2.

const LANGUAGE_LABEL_KEYS = { en: 'settings.english', fil: 'settings.filipino' } as const satisfies Record<Language, string>;

export function ProductsScreen() {
  const { t } = useTranslation();
  const { catalog, catalogVersion, language, setLanguage } = useAppServices();
  const focused = useIsFocused();

  // Re-read when the tab gains focus or a product is saved; SQLite is the source of truth.
  const products = useMemo(() => listProducts(catalog.db), [catalog, catalogVersion, focused]);

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      data={products}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <View style={styles.languageRow}>
          <Text style={styles.label}>{t('settings.language')}</Text>
          {LANGUAGES.map((l) => (
            <Pressable key={l} onPress={() => setLanguage(l)} style={[styles.chip, language === l && styles.chipActive]}>
              <Text style={[styles.chipText, language === l && styles.chipTextActive]}>{t(LANGUAGE_LABEL_KEYS[l])}</Text>
            </Pressable>
          ))}
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>{t('products.empty')}</Text>}
      renderItem={({ item }) => <ProductRow product={item} />}
      ListFooterComponent={
        <>
          <TrashList />
          <GateCheckPanel />
        </>
      }
    />
  );
}

function ProductRow({ product }: { product: ProductListItem }) {
  const { t } = useTranslation();
  const price = product.pricePiece === null ? t('scan.noPrice') : formatCentavos(product.pricePiece);
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.meta}>
          {t('products.shots', { n: product.shots })}
          {product.category === null ? '' : ` · ${product.category}`}
        </Text>
      </View>
      <View style={styles.rowPrice}>
        <Text style={styles.price}>
          {product.unitLabel === null || product.pricePiece === null ? price : t('scan.perUnit', { price, unit: product.unitLabel })}
        </Text>
        {product.pricePack !== null && (
          <Text style={styles.meta}>{t('scan.pack', { price: formatCentavos(product.pricePack) })}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f14' },
  content: { padding: 14, gap: 8, paddingBottom: 32 },
  languageRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  label: { color: '#e6eaef', marginRight: 4 },
  chip: { backgroundColor: '#1b2430', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: '#ffd166' },
  chipText: { color: '#e6eaef', fontWeight: '600' },
  chipTextActive: { color: '#0b0f14' },
  empty: { color: '#9aa5b1', paddingVertical: 24, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12, backgroundColor: '#131a22', borderRadius: 8, padding: 12 },
  rowMain: { flex: 1, gap: 4 },
  rowPrice: { alignItems: 'flex-end', gap: 4 },
  name: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  price: { color: '#ffd166', fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  meta: { color: '#9aa5b1', fontSize: 12 },
});
