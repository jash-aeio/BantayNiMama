import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { RejectionState } from './useRejection';

// The sheet after No, Wrong? or Neither (SR-14, P2-3). P2-4 adds the likely products and a name
// search above "Not in my list" (SR-07).

interface Props {
  readonly rejection: RejectionState;
  readonly nameOf: (id: string) => string;
}

export const RejectPanel = memo(function RejectPanel({ rejection, nameOf }: Props) {
  const { t } = useTranslation();
  const { state } = rejection;
  if (state.stage === 'idle') return null;

  const names = state.pinned.productIds.map(nameOf).join(' / ');

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('scan.reject.title')}</Text>
      <Text style={styles.said} numberOfLines={2}>
        {t('scan.reject.appSaid', { names })}
      </Text>

      {state.stage === 'asking' && (
        <>
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
          <Button label={t('scan.reject.retry')} onPress={rejection.notInList} />
          <Button label={t('scan.reject.cancel')} onPress={rejection.close} secondary />
        </>
      )}

      {state.stage === 'failed' && (
        <>
          <Text style={styles.error}>{t('scan.reject.failed', { message: state.message })}</Text>
          <Button label={t('scan.reject.retry')} onPress={rejection.notInList} />
          <Button label={t('scan.reject.cancel')} onPress={rejection.close} secondary />
        </>
      )}

      {state.stage === 'saved' && (
        <>
          <Text style={styles.ok}>{t('scan.reject.saved')}</Text>
          <Button label={t('scan.reject.next')} onPress={rejection.close} />
        </>
      )}
    </View>
  );
});

function Button({ label, onPress, secondary = false }: { label: string; onPress: () => void; secondary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, secondary && styles.secondary]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(11, 15, 20, 0.94)',
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  said: { color: '#9aa5b1', fontSize: 14 },
  body: { color: '#e6eaef', fontSize: 16 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  warning: { color: '#ffd166', fontSize: 16 },
  error: { color: '#ff6b6b', fontSize: 16 },
  ok: { color: '#7bd88f', fontSize: 18, fontWeight: '700' },
  button: { backgroundColor: '#2b6cb0', borderRadius: 8, minHeight: 52, justifyContent: 'center', alignItems: 'center' },
  secondary: { backgroundColor: '#1b2430' },
  buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 18 },
});
