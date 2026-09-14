import './src/i18n';

import { StatusBar } from 'expo-status-bar';
import i18next from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  usePreviewOutput,
} from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

import { openCatalog, type Catalog } from './src/db/catalog';
import { catalogCounts } from './src/db/products';
import type { VectorIndex } from './src/domain/knn.ts';
import { summarize } from './src/domain/stats.ts';
import { EnrollmentPanel } from './src/features/enrollment/EnrollmentPanel';
import { useEnrollment } from './src/features/enrollment/useEnrollment';
import { ScanOverlay } from './src/features/scanner/ScanOverlay';
import { useScanner, type ScanTiming } from './src/features/scanner/useScanner';
import { LANGUAGES, type Language } from './src/i18n';
import {
  captureReference,
  embedFrame,
  type FrameEmbedding,
  type ReferenceCapture,
  type StageTimings,
} from './src/ml/frameEmbedder';
import { loadEmbeddingModel, type Accelerator, type LoadedModel } from './src/ml/loadModel';
import { MODEL_ID, RETICLE_FRACTION, TARGET_FPS } from './src/ml/model';

// TEMPORARY DEV HOST, replaced by app/ in P1-7. It hosts the real features — enrollment
// (src/features/enrollment) and the scan overlay (src/features/scanner), both translated — next to
// developer diagnostics. The diagnostics are not user copy, which is why they are not translated.

type Mode = 'enroll' | 'scan';

/** How many recent frames the worklet timing summary covers. */
const TIMING_WINDOW = 40;

type ModelState =
  | { state: 'loading'; accelerator: Accelerator }
  | { state: 'loaded'; loaded: LoadedModel }
  | { state: 'error'; accelerator: Accelerator; error: string };

type CatalogState = { ok: true; catalog: Catalog } | { ok: false; error: string };

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
        if (!cancelled) setState({ state: 'error', accelerator, error: messageOf(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [accelerator]);

  return state;
}

function tryOpenCatalog(): CatalogState {
  try {
    const catalog = openCatalog();
    console.log(`[catalog] ${describeCatalog(catalog, catalogCounts(catalog.db))}`);
    return { ok: true, catalog };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export default function App() {
  // Once per launch, and before the camera can capture anything: the orphan-photo sweep inside
  // relies on no enrollment draft existing yet.
  const [catalogState] = useState(tryOpenCatalog);
  if (!catalogState.ok) {
    return (
      <Centered>
        <Text style={styles.info}>bantay.db could not be opened:</Text>
        <Text style={styles.error}>{catalogState.error}</Text>
      </Centered>
    );
  }
  return <DevHost catalog={catalogState.catalog} />;
}

function DevHost({ catalog }: { catalog: Catalog }) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const preview = usePreviewOutput();
  const [accelerator, setAccelerator] = useState<Accelerator>('cpu');
  const modelState = useEmbeddingModel(accelerator);
  const model = modelState.state === 'loaded' ? modelState.loaded.model : undefined;

  // A second, CPU-only model instance for embedding saved JPEGs on the JS thread. The camera
  // worklet calls runSync on `model` continuously, and one TFLite interpreter must never run on
  // two threads at once.
  const stillModelState = useEmbeddingModel('cpu');
  const stillModel = stillModelState.state === 'loaded' ? stillModelState.loaded.model : undefined;

  const [mode, setMode] = useState<Mode>('scan');
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const [language, setLanguage] = useState<Language>('en');

  // The live search index (ADR-014). Enrollment replaces it after each commit, and the scanner
  // reads it on the next frame — that is the whole of SR-24.
  const indexRef = useRef<VectorIndex>(catalog.index);
  const timings = useRef<StageTimings[]>([]);
  const [frameError, setFrameError] = useState<string | null>(null);

  // Set from JS, read by the worklet on its next processed frame.
  const captureRequest = useMemo(() => createSynchronizable(false), []);
  const requestFrameCapture = useCallback(() => captureRequest.setBlocking(true), [captureRequest]);

  const enrollment = useEnrollment({ catalog, indexRef, stillModel, requestFrameCapture });
  const receiveCapture = useRef(enrollment.receiveCapture);
  receiveCapture.current = enrollment.receiveCapture;

  const scanner = useScanner({ catalog, indexRef });
  const { onVector, reset: resetScanner } = scanner;

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  // Timings from one accelerator must never be summarised together with another's.
  useEffect(() => {
    timings.current = [];
    resetScanner();
  }, [accelerator, resetScanner]);

  // Entering scan mode starts a fresh stability window, so a lock never carries votes from frames
  // taken before a product existed.
  useEffect(() => {
    resetScanner();
  }, [mode, resetScanner]);

  // The dev readout reads refs, and re-renders once a second in scan mode — never per frame.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (mode !== 'scan') return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [mode]);

  const onEmbedding = useCallback(
    (result: FrameEmbedding) => {
      timings.current = [...timings.current.slice(-(TIMING_WINDOW - 1)), result.timings];
      if (modeRef.current === 'scan') onVector(result.vector);
    },
    [onVector],
  );

  const onReference = useCallback(
    (capture: ReferenceCapture) => {
      onEmbedding(capture.embedding);
      receiveCapture.current(capture);
    },
    [onEmbedding],
  );

  const onFrameError = useCallback((message: string) => {
    setFrameError((previous) => (previous === message ? previous : message));
  }, []);

  // SR-04 / SR-05: "Add" from an Unknown result opens enrollment in one tap, with the camera still live.
  const onAdd = useCallback(() => setMode('enroll'), []);

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

        if (captureRequest.getDirty()) {
          captureRequest.setBlocking(false);
          scheduleOnRN(onReference, captureReference(frame, model));
        } else {
          scheduleOnRN(onEmbedding, embedFrame(frame, model));
        }
      } catch (e) {
        const stack = e instanceof Error ? (e.stack ?? '').split('\n').slice(0, 4).join(' | ') : '';
        scheduleOnRN(onFrameError, e instanceof Error ? `${e.message} — ${stack}` : String(e));
      } finally {
        frame.dispose();
      }
    },
  });

  const outputs = useMemo(() => [preview, frameOutput], [preview, frameOutput]);

  const counts = useMemo(() => catalogCounts(catalog.db), [catalog, enrollment.savedCount]);

  const onLanguage = useCallback((next: Language) => {
    setLanguage(next);
    void i18next.changeLanguage(next);
  }, []);

  if (!hasPermission) {
    return (
      <Centered>
        <Text style={styles.info}>Camera permission is required.</Text>
        <Tab label="Grant permission" active onPress={() => void requestPermission()} />
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
        {modelState.accelerator !== 'cpu' && <Tab label="Use CPU instead" active onPress={() => setAccelerator('cpu')} />}
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

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.cameraWrap}>
        <Camera style={StyleSheet.absoluteFill} device={device} isActive outputs={outputs} />
        <View pointerEvents="none" style={styles.reticleLayer}>
          <View style={styles.reticle} />
        </View>
        {mode === 'scan' && (
          <ScanOverlay
            locked={scanner.locked}
            thresholds={catalog.meta.thresholds}
            productOf={scanner.productOf}
            onAdd={onAdd}
          />
        )}
      </View>

      <ScrollView
        style={[styles.panel, mode === 'scan' ? styles.panelScan : styles.panelEnroll]}
        contentContainerStyle={styles.panelContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.row}>
          {(['scan', 'enroll'] as const).map((m) => (
            <Tab key={m} label={m} active={mode === m} onPress={() => setMode(m)} />
          ))}
          {LANGUAGES.map((l) => (
            <Tab key={l} label={l} active={language === l} onPress={() => onLanguage(l)} />
          ))}
        </View>

        <Text style={styles.meta}>{describeCatalog(catalog, counts, indexRef.current.size)}</Text>
        {frameError !== null && <Text style={styles.error}>frame error: {frameError}</Text>}

        {mode === 'enroll' && (
          <>
            <Text style={styles.meta}>{describeMeasurements(enrollment.measurements)}</Text>
            <EnrollmentPanel enrollment={enrollment} />
          </>
        )}

        {mode === 'scan' && (
          <>
            <View style={styles.row}>
              {(['cpu', 'android-gpu'] as const).map((a) => (
                <Tab key={a} label={a} active={accelerator === a} onPress={() => setAccelerator(a)} />
              ))}
            </View>
            <Text style={styles.meta}>{describeTimings(timings.current)}</Text>
            <Text style={styles.meta}>{describeScanTimings(scanner.timings.current)}</Text>
            <Text style={styles.meta}>
              {scanner.lastTop.current
                .map((p, i) => `${i + 1}. ${scanner.productOf(p.productId)?.name ?? p.productId} ${p.score.toFixed(3)}`)
                .join(' · ') || 'top 3: —'}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function describeCatalog(catalog: Catalog, counts: { products: number; shots: number }, indexSize = catalog.index.size): string {
  const { meta } = catalog;
  return (
    `bantay.db schema ${catalog.migratedFrom} to ${meta.schemaVersion} · ${meta.embeddingDim}-d · ` +
    `τ ${meta.thresholds.tau} δ ${meta.thresholds.delta} · ${counts.products} products / ${counts.shots} shots · ` +
    `index ${indexSize} · orphan photos removed ${catalog.orphanPhotosRemoved} · other-model shots ${catalog.otherModelShots}`
  );
}

/** Frame-vs-JPEG agreement and bytes per shot over this session's real enrollments (ARCHITECTURE.md §4, NFR-08). */
function describeMeasurements(measurements: readonly { agreement: number; bytes: number }[]): string {
  const agreement = summarize(measurements.map((m) => m.agreement));
  const bytes = summarize(measurements.map((m) => m.bytes));
  if (agreement === null || bytes === null) return 'shots this session: none yet';
  const min = Math.min(...measurements.map((m) => m.agreement));
  return (
    `shots this session n=${agreement.n}: frame-vs-JPEG dot min ${min.toFixed(4)} · median ${agreement.median.toFixed(4)} · ` +
    `JPEG median ${(bytes.median / 1024).toFixed(1)} KB, max ${(bytes.max / 1024).toFixed(1)} KB`
  );
}

/** P1-3 latency diagnostic: worklet per-stage median / p90 over the last TIMING_WINDOW frames. */
function describeTimings(samples: readonly StageTimings[]): string {
  const stage = (name: string, pick: (t: StageTimings) => number) => {
    const s = summarize(samples.map(pick));
    return s === null ? `${name} —` : `${name} ${s.median.toFixed(1)}/${s.p90.toFixed(1)}`;
  };
  return (
    `worklet ms median/p90, n=${samples.length}: ` +
    [
      stage('crop+resize', (t) => t.cropResizeMs),
      stage('runSync', (t) => t.inferenceMs),
      stage('normalize', (t) => t.normalizeMs),
      stage('total', (t) => t.totalMs),
    ].join(' · ')
  );
}

/** P1-6 latency diagnostic: JS-thread KNN and policy + stability, median / p90 (ARCHITECTURE.md §8). */
function describeScanTimings(samples: readonly ScanTiming[]): string {
  const knn = summarize(samples.map((s) => s.knnMs));
  const policy = summarize(samples.map((s) => s.policyMs));
  const last = samples[samples.length - 1];
  if (knn === null || policy === null || last === undefined) return 'js ms: —';
  return (
    `js ms median/p90, n=${knn.n}, ${last.shots} shots: knn ${knn.median.toFixed(2)}/${knn.p90.toFixed(2)} · ` +
    `policy+stability ${policy.median.toFixed(2)}/${policy.p90.toFixed(2)}`
  );
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={[styles.root, styles.centered]}>{children}</View>;
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
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
  panel: { backgroundColor: '#0b0f14' },
  panelScan: { maxHeight: '26%' },
  panelEnroll: { maxHeight: '55%' },
  panelContent: { padding: 14, gap: 10, paddingBottom: 32 },
  row: { flexDirection: 'row', gap: 8 },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: '#1b2430',
    alignItems: 'center',
  },
  tabActive: { backgroundColor: '#ffd166' },
  tabText: { color: '#9aa5b1', fontWeight: '600' },
  tabTextActive: { color: '#0b0f14' },
  meta: { color: '#9aa5b1', fontSize: 12, fontVariant: ['tabular-nums'] },
  error: { color: '#ff6b6b', fontSize: 12 },
  dim: { color: '#7b8794', fontSize: 12 },
  info: { color: '#ffffff', textAlign: 'center' },
});
