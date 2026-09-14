import { useIsFocused } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppServices } from '../../app/services';
import { listTrash, restoreProduct } from '../../db/products';

// Deleted products with Restore (SR-32). Pulled forward from P2-7 so gate step A4 can restore from
// the trash; P2-7's Directory adds thumbnails and the 30-day purge at launch. Hidden while empty.

export function TrashList() {
  const { t } = useTranslation();
  const { catalog, catalogVersion, bumpCatalogVersion, rebuildIndex, logInteraction } = useAppServices();
  const focused = useIsFocused();
  const [error, setError] = useState<string | null>(null);

  // Re-read on focus, as the product list is: the Scan tab deletes while this tab is hidden.
  const items = useMemo(() => listTrash(catalog.db), [catalog, catalogVersion, focused]);
  if (items.length === 0 && error === null) return null;

  const restore = (id: string) => {
    if (!restoreProduct(catalog.db, id)) return;
    logInteraction('restore', [id]);
    try {
      rebuildIndex('restore');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    bumpCatalogVersion();
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t('products.trash.title', { n: items.length })}</Text>
      {error !== null && <Text style={styles.error}>{t('products.trash.restoreFailed', { message: error })}</Text>}
      {items.map((item) => (
        <View key={item.id} style={styles.row}>
          <Text style={styles.name} numberOfLines={2}>
            {item.name}
          </Text>
          <Pressable onPress={() => restore(item.id)} style={styles.button}>
            <Text style={styles.buttonText}>{t('products.trash.restore')}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: 16, gap: 8 },
  title: { color: '#e6eaef', fontSize: 14, fontWeight: '700' },
  error: { color: '#ff6b6b', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#131a22', borderRadius: 8, padding: 12 },
  name: { flex: 1, color: '#9aa5b1', fontSize: 16 },
  button: { backgroundColor: '#1b2430', borderRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  buttonText: { color: '#ffd166', fontWeight: '700' },
});
