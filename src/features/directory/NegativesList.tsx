import { useIsFocused } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppServices } from '../../app/services';
import { deleteNegative, listNegatives } from '../../db/negatives';
import { deleteReferencePhoto, resolvePhotoPath } from '../../db/photos';
import type { NegativeSource } from '../../domain/correction.ts';

// The *Not in my list* items (SR-14, P2-7), with their photos and delete. This is the undo for a
// tindera who marked one of her own products by mistake: while that negative exists, the product can
// never be named (TR-39). A negative has no name, so its photo is the only way to tell which is which.

const SOURCE_KEYS = {
  confirm_no: 'products.negatives.source.confirm_no',
  wrong_lock: 'products.negatives.source.wrong_lock',
  wrong_chip: 'products.negatives.source.wrong_chip',
} as const satisfies Record<NegativeSource, string>;

export function NegativesList() {
  const { t } = useTranslation();
  const { catalog, catalogVersion, bumpCatalogVersion, rebuildIndex, logInteraction } = useAppServices();
  const focused = useIsFocused();
  const [error, setError] = useState<string | null>(null);

  // Re-read on focus: the Scan tab saves negatives while this tab is hidden.
  const items = useMemo(() => listNegatives(catalog.db), [catalog, catalogVersion, focused]);
  if (items.length === 0 && error === null) return null;

  const remove = (id: string) => {
    Alert.alert(t('products.negatives.deleteTitle'), t('products.negatives.deleteBody'), [
      { text: t('products.edit.cancel'), style: 'cancel' },
      {
        text: t('products.negatives.deleteConfirm'),
        style: 'destructive',
        onPress: () => {
          // Row first, then the photo, then the index, whose copy of the vector would otherwise go on
          // silencing matches until the next launch (E-4).
          const photoPath = deleteNegative(catalog.db, id);
          if (photoPath === null) return;
          logInteraction('negativeDeleted', [id]);
          try {
            deleteReferencePhoto(photoPath);
          } catch {
            // Left for the orphan sweep.
          }
          try {
            rebuildIndex('negative');
            setError(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
          bumpCatalogVersion();
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t('products.negatives.title', { n: items.length })}</Text>
      <Text style={styles.hint}>{t('products.negatives.hint')}</Text>
      {error !== null && <Text style={styles.error}>{t('products.negatives.failed', { message: error })}</Text>}
      {items.map((item) => (
        <View key={item.id} style={styles.row}>
          <Image source={{ uri: `file://${resolvePhotoPath(item.photoPath)}` }} style={styles.thumb} />
          <Text style={styles.source} numberOfLines={2}>
            {t(SOURCE_KEYS[item.source])}
          </Text>
          <Pressable onPress={() => remove(item.id)} style={styles.button}>
            <Text style={styles.buttonText}>{t('products.negatives.delete')}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: 16, gap: 8 },
  title: { color: '#e6eaef', fontSize: 14, fontWeight: '700' },
  hint: { color: '#9aa5b1', fontSize: 12 },
  error: { color: '#ff6b6b', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#131a22', borderRadius: 8, padding: 10 },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: '#1b2430' },
  source: { flex: 1, color: '#9aa5b1', fontSize: 14 },
  button: { backgroundColor: '#1b2430', borderRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  buttonText: { color: '#ff9f9f', fontWeight: '700' },
});
