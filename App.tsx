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
import { catalogCounts, getProduct, type Product } from './src/db/products';
import { nearestShots, type VectorIndex } from './src/domain/knn.ts';
import { match, rankProducts, type Decision, type ProductScore } from './src/domain/match.ts';
import { formatCentavos } from './src/domain/money.ts';
import { emptyBuffer, lockedDecision, pushDecision } from './src/domain/stability.ts';
import { summarize } from './src/domain/stats.ts';
import { EnrollmentPanel } from './src/features/enrollment/EnrollmentPanel';
import { useEnrollment } from './src/features/enrollment/useEnrollment';
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

// TEMPORARY DEV HOST, replaced by app/ in P1-7. It hosts the real enrollment feature
// (src/features/enrollment, fully translated) next to a scan readout, so P1-5's "enroll → scan →
// locks" can be checked on device before P1-6 builds the scanner. The readouts below are
// developer diagnostics, not user copy, which is why they are not translated.

type Mode = 'enroll' | 'scan';

/** How many recent frames the on-screen timing summary covers. */
const TIMING_WINDOW = 40;

type ModelState =
  | { state: 'loading'; accelerator: Accelerator }
  | { state: 'loaded'; loaded: LoadedModel }
  | { state: 'error'; accelerator: Accelerator; error: string };

type CatalogState = { ok: true; catalog: Catalog } | { ok: false; error: string };

interface ScanView {
  readonly locked: Decision | null;
  readonly top: readonly ProductScore[];
  /** KNN + policy + stability for this frame, JS thread. */
  readonly searchMs: number;
}

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

  const [mode, setMode] = useState<Mode>('enroll');
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const [language, setLanguage] = useState<Language>('en');

  // The live search index (ADR-014). Enrollment replaces it after each commit, and the scan
  // callback reads it on the next frame — that is the whole of SR-24.
  const indexRef = useRef<VectorIndex>(catalog.index);
  const stability = useRef(emptyBuffer);
  const timings = useRef<StageTimings[]>([]);
  const [scan, setScan] = useState<ScanView | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);

  // Set from JS, read by the worklet on its next processed frame.
  const captureRequest = useMemo(() => createSynchronizable(false), []);
  const requestFrameCapture = useCallback(() => captureRequest.setBlocking(true), [captureRequest]);

  const enrollment = useEnrollment({ catalog, indexRef, stillModel, requestFrameCapture });
  const receiveCapture = useRef(enrollment.receiveCapture);
  receiveCapture.current = enrollment.receiveCapture;

  // Products never change in Phase 1 (no edit, no delete), so a looked-up row can be kept.
  const products = useRef(new Map<string, Product | null>());
  const productOf = useCallback(
    (id: string) => {
      if (!products.current.has(id)) products.current.set(id, getProduct(catalog.db, id));
      return products.current.get(id) ?? null;
    },
    [catalog],
  );

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  // Timings from one accelerator must never be summarised together with another's.
  useEffect(() => {
    timings.current = [];
  }, [accelerator]);

  // Entering scan mode starts a fresh stability window, so a lock never carries votes from frames
  // taken before the product existed.
  useEffect(() => {
    stability.current = emptyBuffer;
    setScan(null);
  }, [mode]);

  const onEmbedding = useCallback(
    (result: FrameEmbedding) => {
      timings.current = [...timings.current.slice(-(TIMING_WINDOW - 1)), result.timings];
      // No state change outside scan mode, so typing in the form never competes with 4 fps renders.
      if (modeRef.current !== 'scan') return;

      const t0 = performance.now();
      const hits = nearestShots(indexRef.current, result.vector);
      stability.current = pushDecision(stability.current, match(hits, catalog.meta.thresholds));
      const locked = lockedDecision(stability.current);
      const searchMs = performance.now() - t0;
      setScan({ locked, top: rankProducts(hits).slice(0, 3), searchMs });
    },
    [catalog],
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
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">
        <View style={styles.row}>
          {(['enroll', 'scan'] as const).map((m) => (
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
            <Text style={styles.lock}>{describeLock(scan?.locked ?? null, productOf)}</Text>
            {scan?.top.map((p, i) => (
              <View key={p.productId} style={styles.scoreRow}>
                <Text style={styles.scoreLabel} numberOfLines={1}>
                  {i + 1}. {productOf(p.productId)?.name ?? p.productId}
                </Text>
                <Text style={styles.scoreValue}>{p.score.toFixed(4)}</Text>
              </View>
            ))}
            {scan !== null && <Text style={styles.dim}>knn + policy + stability {scan.searchMs.toFixed(1)} ms</Text>}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function describeCatalog(catalog: Catalog, counts: { products: number; shots: number }, indexSize = catalog.index.size): string {
  const { meta } = catalog;
  return (
    `bantay.db schema ${catalog.migratedFrom}→${meta.schemaVersion} · ${meta.embeddingDim}-d · ` +
    `τ ${meta.thresholds.tau} δ ${meta.thresholds.delta} · ${counts.products} products / ${counts.shots} shots · ` +
    `index ${indexSize} · orphan photos removed ${catalog.orphanPhotosRemoved} · other-model shots ${catalog.otherModelShots}`
  );
}

function describeLock(locked: Decision | null, productOf: (id: string) => Product | null): string {
  const name = (id: string) => productOf(id)?.name ?? id;
  if (locked === null) return 'settling…';
  switch (locked.kind) {
    case 'accept': {
      const product = productOf(locked.product.productId);
      const price = product?.pricePiece != null ? formatCentavos(product.pricePiece) : '—';
      const margin = locked.margin === null ? '—' : locked.margin.toFixed(3);
      return `LOCK ${name(locked.product.productId)} ${price} · score ${locked.product.score.toFixed(3)} · margin ${margin}`;
    }
    case 'disambiguate':
      return `CHIPS ${name(locked.first.productId)} | ${name(locked.second.productId)} · margin ${locked.margin.toFixed(3)}`;
    case 'unknown':
      return `UNKNOWN${locked.best === null ? '' : ` · best ${name(locked.best.productId)} ${locked.best.score.toFixed(3)}`}`;
  }
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
  panel: { maxHeight: '55%', backgroundColor: '#0b0f14' },
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
  lock: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  error: { color: '#ff6b6b', fontSize: 12 },
  dim: { color: '#7b8794', fontSize: 12 },
  info: { color: '#ffffff', textAlign: 'center' },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  scoreLabel: { color: '#e6eaef', flexShrink: 1 },
  scoreValue: { color: '#ffd166', fontVariant: ['tabular-nums'] },
});
