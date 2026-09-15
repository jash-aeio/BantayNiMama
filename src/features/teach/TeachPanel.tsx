import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';

import { resolvePhotoPath } from '../../db/photos';
import { MAX_EXTRA_SHOTS } from '../../domain/correction.ts';
import type { QualityWarning } from '../../domain/shotQuality.ts';
import { Button } from '../../ui/FormControls';
import type { TeachState } from './useTeach';

// *Teach again* on the Scan tab (SR-33, P2-7): take a photo, see it, then keep or retake it. The photo
// count shows the 3 extra slots shared with corrections (ADR-024), so a replaced photo is no surprise.

const QUALITY_KEYS = {
  tooDark: 'teach.quality.tooDark',
  blownOut: 'teach.quality.blownOut',
  blurred: 'teach.quality.blurred',
} as const satisfies Record<QualityWarning, string>;

export const TeachPanel = memo(function TeachPanel({ teach }: { teach: TeachState }) {
  const { t } = useTranslation();
  const { product, counts, stage, preview, notice } = teach;

  if (product === null) {
    return (
      <View style={styles.root}>
        <Text style={styles.error}>{t('teach.gone')}</Text>
        <Button label={t('teach.done')} onPress={teach.close} tone="secondary" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title} numberOfLines={2}>
        {t('teach.title', { name: product.name })}
      </Text>
      <Text style={styles.coach}>{t('enroll.coach')}</Text>
      <Text style={styles.hint}>{t('teach.hint', { name: product.name })}</Text>
      <Text style={styles.label}>
        {t('teach.counts', { enroll: counts.enroll, extra: counts.correction + counts.teach, max: MAX_EXTRA_SHOTS })}
      </Text>

      {stage === 'review' && preview !== null ? (
        <>
          <View style={styles.reviewRow}>
            <Image source={{ uri: `file://${resolvePhotoPath(preview.photoPath)}` }} style={styles.preview} />
            <Text style={[styles.question, styles.flex]}>{t('teach.review', { name: product.name })}</Text>
          </View>
          {preview.warnings.map((w) => (
            <Text key={w} style={styles.warning}>
              {t(QUALITY_KEYS[w])}
            </Text>
          ))}
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label={t('teach.keep')} onPress={teach.keep} />
            </View>
            <View style={styles.flex}>
              <Button label={t('teach.retake')} onPress={teach.retake} tone="secondary" />
            </View>
          </View>
        </>
      ) : (
        <Button
          label={stage === 'capturing' ? t('teach.capturing') : t('teach.capture')}
          onPress={teach.capture}
          disabled={stage !== 'ready'}
        />
      )}

      {notice?.kind === 'saved' && <Text style={styles.ok}>{t('teach.saved', { name: product.name })}</Text>}
      {notice?.kind === 'failed' && <Text style={styles.error}>{t('teach.failed', { message: notice.message })}</Text>}
      <Button label={t('teach.done')} onPress={teach.close} tone="secondary" disabled={stage === 'saving'} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: 10 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
  coach: { color: '#ffd166', fontWeight: '700', fontSize: 16 },
  hint: { color: '#e6eaef', fontSize: 14 },
  label: { color: '#9aa5b1', fontSize: 12 },
  reviewRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  preview: { width: 112, height: 112, borderRadius: 8, backgroundColor: '#1b2430' },
  question: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  warning: { color: '#ffd166', fontSize: 14 },
  ok: { color: '#7bd88f', fontSize: 14 },
  error: { color: '#ff6b6b', fontSize: 14 },
});
