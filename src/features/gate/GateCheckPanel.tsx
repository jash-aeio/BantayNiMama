import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppServices } from '../../app/services';
import { getProduct } from '../../db/products';
import {
  describeEnrollmentMeasurements,
  describeGateCheck,
  describeInteractions,
  describeLaunch,
  describeLockDetails,
  describeLockLog,
  describeScanTimings,
  describeWorkletTimings,
} from './describe';
import { runGateCheck } from './runGateCheck';

/**
 * The P1-8 gate's debug readout, collapsed at the bottom of the Products tab (operator's choice).
 * It runs on demand in the release build. It also console.logs the lines under [gate], but on the
 * Infinix's release build that output never reached logcat (P1-7), so the screen is the record.
 */
export function GateCheckPanel() {
  const { t } = useTranslation();
  const { catalog, indexRef, stillModel, diagnostics } = useAppServices();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [lines, setLines] = useState<readonly string[]>([]);
  // The lock log lives in a ref; bumping this re-renders after it is cleared.
  const [, setLogVersion] = useState(0);

  const run = () => {
    if (stillModel.state !== 'loaded') {
      setLines([t('gate.needsModel')]);
      return;
    }
    setProgress({ done: 0, total: 0 });
    setLines([]);
    runGateCheck({
      catalog,
      index: indexRef.current,
      stillModel: stillModel.loaded.model,
      embeddingDim: stillModel.loaded.embeddingDim,
      onProgress: (done, total) => setProgress({ done, total }),
    })
      .then(
        (result) => {
          const text = describeGateCheck(result);
          console.log(`[gate]\n${text.join('\n')}`);
          setLines(text);
        },
        (e: unknown) => setLines([`FAIL — the check threw: ${e instanceof Error ? e.message : String(e)}`]),
      )
      .finally(() => setProgress(null));
  };

  const clearLockLog = () => {
    diagnostics.lockLog.current = [];
    setLogVersion((n) => n + 1);
  };

  const nameOf = (id: string) => getProduct(catalog.db, id)?.name ?? id;

  return (
    <View style={styles.root}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.header}>
        <Text style={styles.headerText}>
          {open ? '▾' : '▸'} {t('gate.title')}
        </Text>
      </Pressable>
      {open && (
        <View style={styles.body}>
          <Text style={styles.line}>{describeLaunch(catalog)}</Text>
          <Pressable onPress={run} disabled={progress !== null} style={[styles.button, progress !== null && styles.disabled]}>
            <Text style={styles.buttonText}>
              {progress !== null ? t('gate.running', { done: progress.done, total: progress.total }) : t('gate.run')}
            </Text>
          </Pressable>
          {lines.map((line, i) => (
            <Text key={i} style={line.startsWith('PASS') ? styles.pass : line.startsWith('FAIL') ? styles.fail : styles.line}>
              {line}
            </Text>
          ))}
          <Text style={styles.line}>{describeWorkletTimings(diagnostics.workletTimings.current)}</Text>
          <Text style={styles.line}>{describeScanTimings(diagnostics.scanTimings.current)}</Text>
          <Text style={styles.line}>{describeEnrollmentMeasurements(diagnostics.enrollmentMeasurements.current)}</Text>
          {describeInteractions(diagnostics.interactionLog.current, nameOf).map((line, i) => (
            <Text key={`tap-${i}`} style={styles.line}>
              {line}
            </Text>
          ))}

          <Pressable onPress={clearLockLog} style={styles.button}>
            <Text style={styles.buttonText}>{t('gate.clearLog')}</Text>
          </Pressable>
          {describeLockLog(diagnostics.lockLog.current, nameOf).map((line, i) => (
            <Text key={`log-${i}`} style={styles.line}>
              {line}
            </Text>
          ))}
          {describeLockDetails(diagnostics.lockLog.current, nameOf).map((line, i) => (
            <Text key={`detail-${i}`} style={styles.line}>
              {line}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: 24, borderTopWidth: 1, borderTopColor: '#1b2430', paddingTop: 12 },
  header: { paddingVertical: 8 },
  headerText: { color: '#9aa5b1', fontWeight: '700' },
  body: { gap: 8 },
  button: { backgroundColor: '#1b2430', borderRadius: 6, paddingVertical: 12, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontWeight: '700' },
  line: { color: '#9aa5b1', fontSize: 12, fontVariant: ['tabular-nums'] },
  pass: { color: '#7bd88f', fontSize: 14, fontWeight: '700' },
  fail: { color: '#ff6b6b', fontSize: 14, fontWeight: '700' },
});
