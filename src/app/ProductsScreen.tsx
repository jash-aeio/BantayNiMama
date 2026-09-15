import { useIsFocused, useNavigation, type NavigationProp } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listReferencePhotos, resolvePhotoPath } from '../db/photos';
import { listDirectory, type DirectoryItem } from '../db/products';
import { DIRECTORY_SORTS, directoryView, formatBytes, storageSummary, type DirectorySort } from '../domain/directory.ts';
import { LANGUAGES, type Language } from '../domain/language.ts';
import { formatCentavos } from '../domain/money.ts';
import { NegativesList } from '../features/directory/NegativesList';
import { ProductEditPanel } from '../features/directory/ProductEditPanel';
import { TrashList } from '../features/directory/TrashList';
import { GateCheckPanel } from '../features/gate/GateCheckPanel';
import { useAppServices, type TabParams } from './services';

// The Products tab, as the Directory (SR-30–SR-35, P2-7): search, sort, edit, *Teach again*, the trash,
// the *Not in my list* items, and the photos' storage. The gate check stays at the bottom, collapsed.

const LANGUAGE_LABEL_KEYS = { en: 'settings.english', fil: 'settings.filipino' } as const satisfies Record<Language, string>;

const SORT_KEYS = {
  name: 'products.sort.name',
  recentlyAdded: 'products.sort.recentlyAdded',
  recentlyScanned: 'products.sort.recentlyScanned',
} as const satisfies Record<DirectorySort, string>;

export function ProductsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<TabParams>>();
  const { catalog, catalogVersion, language, setLanguage, requestTeach } = useAppServices();
  const focused = useIsFocused();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DirectorySort>('name');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Re-read when the tab gains focus or the catalog changes; SQLite is the source of truth.
  const products = useMemo(() => listDirectory(catalog.db), [catalog, catalogVersion, focused]);
  const shown = useMemo(() => directoryView(products, query, sort), [products, query, sort]);
  // SR-35: every JPEG in photos/, trashed products' and negatives' included. Listed on focus only,
  // never while the Scan tab is scanning.
  const storage = useMemo(() => storageSummary(listReferencePhotos()), [catalogVersion, focused]);

  const teach = (productId: string) => {
    setEditingId(null);
    requestTeach(productId);
    navigation.navigate('Scan');
  };

  return (
    <>
      <FlatList
        style={styles.root}
        contentContainerStyle={styles.content}
        data={shown}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.chipRow}>
              <Text style={styles.label}>{t('settings.language')}</Text>
              {LANGUAGES.map((l) => (
                <Pressable key={l} onPress={() => setLanguage(l)} style={[styles.chip, language === l && styles.chipActive]}>
                  <Text style={[styles.chipText, language === l && styles.chipTextActive]}>{t(LANGUAGE_LABEL_KEYS[l])}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('products.searchPlaceholder')}
              placeholderTextColor="#7b8794"
              autoCorrect={false}
              style={styles.search}
            />
            <View style={styles.chipRow}>
              <Text style={styles.label}>{t('products.sort.label')}</Text>
              {DIRECTORY_SORTS.map((s) => (
                <Pressable key={s} onPress={() => setSort(s)} style={[styles.chip, sort === s && styles.chipActive]}>
                  <Text style={[styles.chipText, sort === s && styles.chipTextActive]}>{t(SORT_KEYS[s])}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.meta}>
              {t('products.count', { shown: shown.length, total: products.length })} ·{' '}
              {t('products.storage', { count: storage.count, size: formatBytes(storage.bytes) })}
            </Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>{t(products.length === 0 ? 'products.empty' : 'products.noMatches')}</Text>}
        renderItem={({ item }) => <DirectoryRow product={item} onPress={setEditingId} />}
        ListFooterComponent={
          <>
            <TrashList />
            <NegativesList />
            <GateCheckPanel />
          </>
        }
      />
      <Modal visible={editingId !== null} animationType="slide" onRequestClose={() => setEditingId(null)}>
        <ScrollView
          style={styles.modal}
          contentContainerStyle={[styles.modalContent, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          {editingId !== null && <ProductEditPanel key={editingId} productId={editingId} onClose={() => setEditingId(null)} onTeach={teach} />}
        </ScrollView>
      </Modal>
    </>
  );
}

function DirectoryRow({ product, onPress }: { product: DirectoryItem; onPress: (productId: string) => void }) {
  const { t } = useTranslation();
  const price = product.pricePiece === null ? t('scan.noPrice') : formatCentavos(product.pricePiece);
  return (
    <Pressable onPress={() => onPress(product.id)} style={styles.row} accessibilityRole="button">
      {product.photoPath === null ? (
        <View style={styles.thumb} />
      ) : (
        <Image
          source={{ uri: `file://${resolvePhotoPath(product.photoPath)}` }}
          style={styles.thumb}
          accessibilityLabel={t('scan.confirm.photoLabel', { name: product.name })}
        />
      )}
      <View style={styles.rowMain}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.meta}>
          {t('products.shots', { n: product.shots })}
          {product.category === null ? '' : ` · ${product.category}`}
          {product.isAmbiguous ? ` · ${t('products.repacked')}` : ''}
        </Text>
      </View>
      <View style={styles.rowPrice}>
        <Text style={styles.price}>
          {product.unitLabel === null || product.pricePiece === null ? price : t('scan.perUnit', { price, unit: product.unitLabel })}
        </Text>
        {product.pricePack !== null && <Text style={styles.meta}>{t('scan.pack', { price: formatCentavos(product.pricePack) })}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f14' },
  content: { padding: 14, gap: 8, paddingBottom: 32 },
  header: { gap: 10, marginBottom: 8 },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  label: { color: '#e6eaef', marginRight: 4 },
  chip: { backgroundColor: '#1b2430', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: '#ffd166' },
  chipText: { color: '#e6eaef', fontWeight: '600' },
  chipTextActive: { color: '#0b0f14' },
  search: { backgroundColor: '#1b2430', color: '#ffffff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  empty: { color: '#9aa5b1', paddingVertical: 24, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#131a22', borderRadius: 8, padding: 10 },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: '#1b2430' },
  rowMain: { flex: 1, gap: 4 },
  rowPrice: { alignItems: 'flex-end', gap: 4 },
  name: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  price: { color: '#ffd166', fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  meta: { color: '#9aa5b1', fontSize: 12 },
  modal: { flex: 1, backgroundColor: '#0b0f14' },
  modalContent: { paddingHorizontal: 16 },
});
