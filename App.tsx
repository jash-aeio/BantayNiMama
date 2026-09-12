import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  usePreviewOutput,
} from 'react-native-vision-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { scheduleOnRN } from 'react-native-worklets';

import { MODEL_ID, RETICLE_FRACTION, TARGET_FPS } from './src/spike/config';
import { embedFrame, type EmbedResult } from './src/spike/embed';
import {
  exportDataset,
  load,
  save,
  type SpikeDataset,
  type TestFrame,
} from './src/spike/dataset';
import { rankProducts, type Candidate, type Shot } from './src/spike/vectors';

type Mode = 'scan' | 'enroll' | 'collect';

const DEVICE_NAME = `${Platform.OS} ${Platform.Version}`;

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const preview = usePreviewOutput();
  const tflite = useTensorflowModel(
    require('./assets/models/mobilenet_v3_large.tflite'),
    [],
  );
  const model = tflite.state === 'loaded' ? tflite.model : undefined;

  const [mode, setMode] = useState<Mode>('enroll');
  const [label, setLabel] = useState('');
  const [dataset, setDataset] = useState<SpikeDataset>(() => load(DEVICE_NAME));
  const [live, setLive] = useState<EmbedResult | null>(null);
  const [ranked, setRanked] = useState<Candidate[]>([]);

  // The latest embedding, kept in a ref so the capture buttons can read it
  // without the whole panel re-rendering on every frame.
  const latest = useRef<EmbedResult | null>(null);
  const shotsRef = useRef<Shot[]>(dataset.shots);
  shotsRef.current = dataset.shots;

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  const onEmbedding = useCallback((result: EmbedResult) => {
    latest.current = result;
    setLive(result);
    setRanked(rankProducts(result.vector, shotsRef.current).slice(0, 3));
  }, []);

  // TR-26: throttle inside the worklet. Holding the interval on the camera
  // thread is what makes the dropped frames actually free — bouncing to JS to
  // decide whether to skip would defeat the point.
  const lastRun = useRef(0);
  const minIntervalMs = 1000 / TARGET_FPS;

  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    onFrame: (frame) => {
      'worklet';
      try {
        if (model == null) return;
        const now = performance.now();
        if (now - lastRun.current < minIntervalMs) return;
        lastRun.current = now;

        const result = embedFrame(frame, model);
        if (result != null) scheduleOnRN(onEmbedding, result);
      } finally {
        frame.dispose();
      }
    },
  });

  const outputs = useMemo(() => [preview, frameOutput], [preview, frameOutput]);

  const persist = useCallback((next: SpikeDataset) => {
    setDataset(next);
    save(next);
  }, []);

  const captureShot = useCallback(() => {
    const result = latest.current;
    if (result == null) {
      Alert.alert('No embedding yet');
      return;
    }
    const name = label.trim();
    if (name === '') {
      Alert.alert('Type the product label first');
      return;
    }
    persist({
      ...dataset,
      dim: result.dim,
      shots: [...dataset.shots, { label: name, vector: result.vector }],
    });
  }, [dataset, label, persist]);

  const captureFrame = useCallback(() => {
    const result = latest.current;
    if (result == null) {
      Alert.alert('No embedding yet');
      return;
    }
    const name = label.trim();
    if (name === '') {
      Alert.alert('Type the TRUE label first');
      return;
    }
    const frame: TestFrame = {
      trueLabel: name,
      vector: result.vector,
      elapsedMs: result.elapsedMs,
      at: Date.now(),
    };
    persist({ ...dataset, dim: result.dim, frames: [...dataset.frames, frame] });
  }, [dataset, label, persist]);

  const onExport = useCallback(() => {
    exportDataset().catch((e: Error) => Alert.alert('Export failed', e.message));
  }, []);

  if (!hasPermission) {
    return (
      <Centered>
        <Text style={styles.info}>Camera permission is required.</Text>
        <Button label="Grant permission" onPress={() => void requestPermission()} />
      </Centered>
    );
  }
  if (device == null) {
    return (
      <Centered>
        <Text style={styles.info}>No back camera found.</Text>
      </Centered>
    );
  }
  if (tflite.state === 'error') {
    return (
      <Centered>
        <Text style={styles.info}>Model failed to load:</Text>
        <Text style={styles.dim}>{tflite.error.message}</Text>
      </Centered>
    );
  }
  if (model == null) {
    return (
      <Centered>
        <ActivityIndicator color="#ffffff" />
        <Text style={styles.info}>Loading {MODEL_ID}…</Text>
      </Centered>
    );
  }

  const shotCounts = countByLabel(dataset.shots.map((s) => s.label));
  const first = ranked[0];
  const second = ranked[1];

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.cameraWrap}>
        <Camera style={StyleSheet.absoluteFill} device={device} isActive outputs={outputs} />
        <View pointerEvents="none" style={styles.reticleLayer}>
          <View style={styles.reticle} />
        </View>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <View style={styles.row}>
          {(['enroll', 'scan', 'collect'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[styles.tab, mode === m && styles.tabActive]}
            >
              <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>{m}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.meta}>
          dim {live?.dim ?? dataset.dim} · {live ? `${live.elapsedMs.toFixed(1)} ms` : 'waiting for frames'} ·{' '}
          {dataset.shots.length} shots / {Object.keys(shotCounts).length} products ·{' '}
          {dataset.frames.length} test frames
        </Text>

        {mode !== 'scan' && (
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder={
              mode === 'enroll'
                ? 'Product label (e.g. palmolive-green-sachet)'
                : 'TRUE label of what you are pointing at'
            }
            placeholderTextColor="#7b8794"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        )}

        {mode === 'enroll' && <Button label="Capture reference shot" onPress={captureShot} />}
        {mode === 'collect' && <Button label="Record test frame" onPress={captureFrame} />}

        <Text style={styles.heading}>Top 3</Text>
        {ranked.length === 0 && <Text style={styles.dim}>No reference shots enrolled yet.</Text>}
        {ranked.map((c, i) => (
          <View key={c.label} style={styles.scoreRow}>
            <Text style={styles.scoreLabel} numberOfLines={1}>
              {i + 1}. {c.label}
            </Text>
            <Text style={styles.scoreValue}>{c.score.toFixed(4)}</Text>
          </View>
        ))}
        {first !== undefined && second !== undefined && (
          <Text style={styles.dim}>margin {(first.score - second.score).toFixed(4)}</Text>
        )}

        <Text style={styles.heading}>Enrolled</Text>
        <Text style={styles.dim}>
          {Object.entries(shotCounts)
            .map(([k, v]) => `${k} (${v})`)
            .join(', ') || '—'}
        </Text>

        <Button label="Export dataset JSON" onPress={onExport} />
      </ScrollView>
    </View>
  );
}

function countByLabel(labels: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of labels) out[l] = (out[l] ?? 0) + 1;
  return out;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={[styles.root, styles.centered]}>{children}</View>;
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f14' },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  cameraWrap: { flex: 1 },
  reticleLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: `${RETICLE_FRACTION * 100}%`,
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: '#ffd166',
    borderRadius: 8,
  },
  panel: { maxHeight: '48%', backgroundColor: '#0b0f14' },
  panelContent: { padding: 14, gap: 10, paddingBottom: 32 },
  row: { flexDirection: 'row', gap: 8 },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#1b2430',
    alignItems: 'center',
  },
  tabActive: { backgroundColor: '#ffd166' },
  tabText: { color: '#9aa5b1', fontWeight: '600' },
  tabTextActive: { color: '#0b0f14' },
  meta: { color: '#9aa5b1', fontSize: 12, fontVariant: ['tabular-nums'] },
  input: {
    backgroundColor: '#1b2430',
    color: '#ffffff',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: { backgroundColor: '#2b6cb0', borderRadius: 6, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontWeight: '700' },
  heading: { color: '#ffffff', fontWeight: '700', marginTop: 4 },
  dim: { color: '#7b8794', fontSize: 12 },
  info: { color: '#ffffff', textAlign: 'center' },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  scoreLabel: { color: '#e6eaef', flexShrink: 1 },
  scoreValue: { color: '#ffd166', fontVariant: ['tabular-nums'] },
});
