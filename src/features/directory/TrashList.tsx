import { useIsFocused } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppServices } from '../../app/services';
import { resolvePhotoPath } from '../../db/photos';
import { listTrash, restoreProduct } from '../../db/products';
import { trashDaysLeft } from '../../domain/trash.ts';

// Deleted products with Restore (SR-32). Pulled forward into P2-4 so gate step A4 could restore from
// the trash; P2-7 adds the thumbnails and the days left before the launch purge. Hidden while empty.

export function TrashList() {
  const { t } = useTranslation();
  const { catalog, catalogVersion, bumpCatalogVersion, rebuildIndex, logInteraction } = useAppServices();
  const focused = useIsFocused();
  const [error, setError] = useState<string | null>(null);

  // Re-read on focus, as the product list is: the Scan tab deletes while this tab is hidden.
  const items = useMemo(() => listTrash(catalog.db), [catalog, catalogVersion, focused]);
  // Read with the list. Days only change once a day, so a stale "now" costs nothing.
  const now = useMemo(() => Date.now(), [items]);
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
          {item.photoPath === null ? (
            <View style={styles.thumb} />
          ) : (
            <Image source={{ uri: `file://${resolvePhotoPath(item.photoPath)}` }} style={styles.thumb} />
          )}
          <View style={styles.main}>
            <Text style={styles.name} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={styles.meta}>{t('products.trash.daysLeft', { days: trashDaysLeft(item.deletedAt, now) })}</Text>
          </View>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#131a22', borderRadius: 8, padding: 10 },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: '#1b2430' },
  main: { flex: 1, gap: 4 },
  name: { color: '#9aa5b1', fontSize: 16 },
  meta: { color: '#7b8794', fontSize: 12 },
  button: { backgroundColor: '#1b2430', borderRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  buttonText: { color: '#ffd166', fontWeight: '700' },
});
