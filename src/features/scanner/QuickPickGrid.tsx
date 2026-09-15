import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { resolvePhotoPath } from '../../db/photos';
import type { QuickPickProduct } from '../../db/products';

// The quick-pick tiles (SR-10, P2-5): photo and name in quickPickTiles' fixed order, with no price
// until a tap (operator's call). One horizontal row, so a grid lock covers no more of the preview than
// a chip card, however many repacked products the store has.

interface Props {
  /** Already ordered by quickPickTiles. */
  readonly tiles: readonly QuickPickProduct[];
  /** The tile the tindera tapped, or null. Only her tap highlights a tile, never the scanner. */
  readonly pickedId: string | null;
  readonly onPick: (productId: string) => void;
}

export const QuickPickGrid = memo(function QuickPickGrid({ tiles, pickedId, onPick }: Props) {
  const { t } = useTranslation();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {tiles.map((p) => {
        const active = p.id === pickedId;
        return (
          <Pressable
            key={p.id}
            onPress={() => onPick(p.id)}
            style={[styles.tile, active && styles.tileActive]}
            accessibilityRole="button"
            accessibilityLabel={p.name}
          >
            {p.photoPath === null ? (
              <View style={styles.photo} />
            ) : (
              <Image
                source={{ uri: `file://${resolvePhotoPath(p.photoPath)}` }}
                style={styles.photo}
                accessibilityLabel={t('scan.confirm.photoLabel', { name: p.name })}
              />
            )}
            <Text style={[styles.name, active && styles.nameActive]} numberOfLines={2}>
              {p.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  row: { gap: 8 },
  tile: { width: 104, backgroundColor: '#1b2430', borderRadius: 8, padding: 6, gap: 6 },
  tileActive: { backgroundColor: '#ffd166' },
  photo: { width: 92, height: 92, borderRadius: 6, backgroundColor: '#0b0f14' },
  name: { color: '#ffffff', fontWeight: '600', textAlign: 'center', minHeight: 36 },
  nameActive: { color: '#0b0f14' },
});
