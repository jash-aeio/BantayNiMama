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
import { scheduleOnRN } from 'react-native-worklets';

import { runStorageCheck } from './src/db/devCheck';
import { summarize } from './src/domain/stats.ts';
import { dot } from './src/domain/vector.ts';
import { embedFrame, type FrameEmbedding, type StageTimings } from './src/ml/frameEmbedder';
import { loadEmbeddingModel, type Accelerator, type LoadedModel } from './src/ml/loadModel';
import { MODEL_ID, RETICLE_FRACTION, TARGET_FPS } from './src/ml/model';
import {
  exportDataset,
  load,
  save,
  saveDatasetToFolder,
  type SpikeDataset,
  type TestFrame,
} from './src/spike/dataset';
import { rankProducts, type Candidate, type Shot } from './src/spike/vectors';

// PHASE 0 SPIKE UI, now running on the Phase 1 modules (src/ml, src/db). Throwaway: replaced by
// app/ in P1-7. The P1-3 additions — CPU/GPU switch and per-stage timings — are temporary too.

type Mode = 'scan' | 'enroll' | 'collect';

const DEVICE_NAME = `${Platform.OS} ${Platform.Version}`;

/** How many recent frames the on-screen timing summary covers. */
const TIMING_WINDOW = 40;

interface Live {
  vector: number[];
  elapsedMs: number;
  dim: number;
  norm: number;
}

type ModelState =
  | { state: 'loading'; accelerator: Accelerator }
  | { state: 'loaded'; loaded: LoadedModel }
  | { state: 'error'; accelerator: Accelerator; error: string };

function useEmbeddingModel(accelerator: Accelerator): ModelState {
  const [state, setState] = useState<ModelState>({ state: 'loading', accelerator });

  useEffect(() => {
    let cancelled = false;
    setState({ state: 'loading', accelerator });
    loadEmbeddingModel(accelerator).then(
      (loaded) => {
        if (!cancelled) setState({ state: 'loaded', loaded });
      },
      (e: unknown) => {
        if (!cancelled) setState({ state: 'error', accelerator, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [accelerator]);

  return state;
}

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const preview = usePreviewOutput();
  const [accelerator, setAccelerator] = useState<Accelerator>('cpu');
  const modelState = useEmbeddingModel(accelerator);
  const model = modelState.state === 'loaded' ? modelState.loaded.model : undefined;

  // P1-2 storage check: run once, show on screen and in logcat (tag ReactNativeJS).
  const dbProbe = useMemo(() => {
    const text = runStorageCheck();
    console.log(`[P1-2 storage check]\n${text}`);
    return text;
  }, []);

  const [mode, setMode] = useState<Mode>('enroll');
  const [label, setLabel] = useState('');
  const [dataset, setDataset] = useState<SpikeDataset>(() => load(DEVICE_NAME));
  const [live, setLive] = useState<Live | null>(null);
  const [ranked, setRanked] = useState<Candidate[]>([]);
  const [frameError, setFrameError] = useState<string | null>(null);

  // The latest embedding, kept in a ref so the capture buttons can read it
  // without the whole panel re-rendering on every frame.
  const latest = useRef<Live | null>(null);
  const shotsRef = useRef<Shot[]>(dataset.shots);
  shotsRef.current = dataset.shots;
  const timings = useRef<StageTimings[]>([]);

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  // Timings from one accelerator must never be summarised together with another's.
  useEffect(() => {
    timings.current = [];
    setLive(null);
  }, [accelerator]);

  const onEmbedding = useCallback((result: FrameEmbedding) => {
    const vector = Array.from(result.vector);
    latest.current = {
      vector,
      elapsedMs: result.timings.totalMs,
      dim: result.vector.length,
      norm: Math.sqrt(dot(result.vector, result.vector)),
    };
    timings.current = [...timings.current.slice(-(TIMING_WINDOW - 1)), result.timings];
    setLive(latest.current);
    setRanked(rankProducts(vector, shotsRef.current).slice(0, 3));
  }, []);

  const onFrameError = useCallback((message: string) => {
    setFrameError((previous) => (previous === message ? previous : message));
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

        scheduleOnRN(onEmbedding, embedFrame(frame, model));
      } catch (e) {
        scheduleOnRN(onFrameError, e instanceof Error ? e.message : String(e));
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

  // Undo is by position because a shot carries no id, timestamp or photo — the
  // last one captured is the only one the operator can reliably point at.
  const undoLastShot = useCallback(() => {
    if (dataset.shots.length === 0) return;
    persist({ ...dataset, shots: dataset.shots.slice(0, -1) });
  }, [dataset, persist]);

  const undoLastFrame = useCallback(() => {
    if (dataset.frames.length === 0) return;
    persist({ ...dataset, frames: dataset.frames.slice(0, -1) });
  }, [dataset, persist]);

  // Test frames are deliberately left alone: dropping frames as a side effect
  // would silently change what the gate is scored on. The prompt warns instead,
  // because frames whose label has no shots can only ever score as misses.
  const deleteProduct = useCallback(
    (name: string) => {
      const shotCount = dataset.shots.filter((s) => s.label === name).length;
      const frameCount = dataset.frames.filter((f) => f.trueLabel === name).length;
      const warning =
        frameCount > 0
          ? `\n\n${frameCount} test frame(s) still use this label. With no shots they will all score as misses.`
          : '';
      Alert.alert(`Delete "${name}"?`, `Removes all ${shotCount} reference shot(s).${warning}`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            persist({ ...dataset, shots: dataset.shots.filter((s) => s.label !== name) }),
        },
      ]);
    },
    [dataset, persist],
  );

  const onExport = useCallback(() => {
    exportDataset().catch((e: Error) => Alert.alert('Export failed', e.message));
  }, []);

  const onSaveToFolder = useCallback(() => {
    saveDatasetToFolder()
      .then((path) =>
        Alert.alert(
          'Saved',
          `${path}\n${dataset.shots.length} shots · ${dataset.frames.length} test frames`,
        ),
      )
      .catch((e: Error) => Alert.alert('Save failed', e.message));
  }, [dataset]);

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
  if (modelState.state === 'error') {
    return (
      <Centered>
        <Text style={styles.info}>Model failed to load ({modelState.accelerator}):</Text>
        <Text style={styles.dim}>{modelState.error}</Text>
        {modelState.accelerator !== 'cpu' && <Button label="Use CPU instead" onPress={() => setAccelerator('cpu')} />}
      </Centered>
    );
  }
  if (model == null) {
    return (
      <Centered>
        <ActivityIndicator color="#ffffff" />
        <Text style={styles.info}>
          Loading {MODEL_ID} ({accelerator})…
        </Text>
      </Centered>
    );
  }

  const shotCounts = countByLabel(dataset.shots.map((s) => s.label));
  const first = ranked[0];
  const second = ranked[1];
  const lastShot = dataset.shots[dataset.shots.length - 1];
  const lastFrame = dataset.frames[dataset.frames.length - 1];

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

        <View style={styles.row}>
          {(['cpu', 'android-gpu'] as const).map((a) => (
            <Pressable
              key={a}
              onPress={() => setAccelerator(a)}
              style={[styles.tab, accelerator === a && styles.tabActive]}
            >
              <Text style={[styles.tabText, accelerator === a && styles.tabTextActive]}>{a}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.meta}>
          {accelerator} · dim {live?.dim ?? '—'} · |v| {live ? live.norm.toFixed(5) : '—'} ·{' '}
          {dataset.shots.length} shots / {Object.keys(shotCounts).length} products ·{' '}
          {dataset.frames.length} test frames
        </Text>
        <Text style={styles.meta}>{describeTimings(timings.current)}</Text>
        {frameError !== null && <Text style={styles.error}>frame error: {frameError}</Text>}
        <Text style={styles.meta}>{dbProbe}</Text>

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
        {mode === 'enroll' && lastShot !== undefined && (
          <Button label={`Undo last shot (${lastShot.label})`} onPress={undoLastShot} secondary />
        )}
        {mode === 'collect' && <Button label="Record test frame" onPress={captureFrame} />}
        {mode === 'collect' && lastFrame !== undefined && (
          <Button
            label={`Undo last test frame (${lastFrame.trueLabel})`}
            onPress={undoLastFrame}
            secondary
          />
        )}

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
        {Object.keys(shotCounts).length === 0 ? (
          <Text style={styles.dim}>—</Text>
        ) : (
          <>
            <Text style={styles.dim}>Tap a product to delete all its shots.</Text>
            <View style={styles.chips}>
              {Object.entries(shotCounts).map(([k, v]) => (
                <Pressable key={k} onPress={() => deleteProduct(k)} style={styles.chip}>
                  <Text style={styles.chipText}>
                    {k} ({v}) ✕
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Button label="Save dataset to folder" onPress={onSaveToFolder} />
        <Button label="Export dataset JSON" onPress={onExport} secondary />
      </ScrollView>
    </View>
  );
}

/** P1-3 latency diagnostic: per-stage median / p90 over the last TIMING_WINDOW frames. */
function describeTimings(samples: readonly StageTimings[]): string {
  const stage = (name: string, pick: (t: StageTimings) => number) => {
    const s = summarize(samples.map(pick));
    return s === null ? `${name} —` : `${name} ${s.median.toFixed(1)}/${s.p90.toFixed(1)}`;
  };
  return (
    `ms median/p90, n=${samples.length}: ` +
    [
      stage('crop+resize', (t) => t.cropResizeMs),
      stage('runSync', (t) => t.inferenceMs),
      stage('normalize', (t) => t.normalizeMs),
      stage('total', (t) => t.totalMs),
    ].join(' · ')
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

function Button({
  label,
  onPress,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.button, secondary && styles.buttonSecondary]}>
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
  error: { color: '#ff6b6b', fontSize: 12 },
  input: {
    backgroundColor: '#1b2430',
    color: '#ffffff',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: { backgroundColor: '#2b6cb0', borderRadius: 6, paddingVertical: 12, alignItems: 'center' },
  buttonSecondary: { backgroundColor: '#1b2430' },
  buttonText: { color: '#ffffff', fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: '#1b2430', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: '#e6eaef', fontSize: 12 },
  heading: { color: '#ffffff', fontWeight: '700', marginTop: 4 },
  dim: { color: '#7b8794', fontSize: 12 },
  info: { color: '#ffffff', textAlign: 'center' },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  scoreLabel: { color: '#e6eaef', flexShrink: 1 },
  scoreValue: { color: '#ffd166', fontVariant: ['tabular-nums'] },
});
