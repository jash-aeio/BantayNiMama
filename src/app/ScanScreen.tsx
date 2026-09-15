import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, useFrameOutput, usePreviewOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

import { catalogCounts, listProducts, listQuickPickProducts, markScanned } from '../db/products';
import { FIRST_RUN_TARGET } from '../domain/firstRun.ts';
import type { AddSource, InteractionKind } from '../domain/interactionLog.ts';
import { EnrollmentPanel } from '../features/enrollment/EnrollmentPanel';
import { useEnrollment } from '../features/enrollment/useEnrollment';
import { CameraAccessPanel } from '../features/firstRun/CameraAccessPanel';
import { useCameraAccess } from '../features/firstRun/useCameraAccess';
import { PriceEditPanel } from '../features/scanner/PriceEditPanel';
import { RejectPanel } from '../features/scanner/RejectPanel';
import { ScanOverlay } from '../features/scanner/ScanOverlay';
import { useRejection } from '../features/scanner/useRejection';
import { useScanner } from '../features/scanner/useScanner';
import { useUndoDelete } from '../features/scanner/useUndoDelete';
import { TeachPanel } from '../features/teach/TeachPanel';
import { useTeach } from '../features/teach/useTeach';
import { captureReference, embedFrame, type FrameEmbedding, type ReferenceCapture } from '../ml/frameEmbedder';
import { RETICLE_FRACTION, TARGET_FPS } from '../ml/model';
import { useAppServices } from './services';

/** How many recent frames the worklet timing samples cover. */
const WORKLET_TIMING_WINDOW = 40;

/** SR-25 is timed from these (interactionLog.enrollmentTimes). */
const ADD_KINDS = {
  button: 'addFromButton',
  unknown: 'addFromUnknown',
  banner: 'addFromBanner',
  firstRun: 'addFromFirstRun',
} as const satisfies Record<AddSource, InteractionKind>;

/**
 * The Scan tab: one camera for scanning, enrollment, the reject sheet, the price editor and *Teach
 * again*.
 *
 * Each of those opens in a panel under the live preview rather than on a second screen. A second
 * camera with its own frame processor would need the scanner's stopped first, and SR-05 asks that
 * Add never blocks the preview. The panel also keeps text fields above the keyboard. The camera is
 * active only while this tab is focused, so the Products tab costs no inference (NFR-06).
 *
 * Voting pauses while a panel or the pinned quick-pick grid is open (P2-3, P2-4, P2-5). The card is
 * then pinned to what the tindera tapped, and a lock changing under her finger cannot redirect the
 * tap to another product. Resuming starts a fresh stability window, and so does every catalog write.
 *
 * Until five products exist, enrollment is the guided add (SR-44, P2-6): an *n of 5* banner, progress
 * in the panel, and *Finish later* in place of *Back to scanning*.
 */
export function ScanScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const {
    catalog,
    indexRef,
    frameModel,
    stillModel,
    diagnostics,
    catalogVersion,
    bumpCatalogVersion,
    rebuildIndex,
    logInteraction: log,
    firstRun,
    finishFirstRunLater,
    consumeGuidedStart,
    consumeTeachRequest,
    teachVersion,
  } = useAppServices();
  const focused = useIsFocused();
  // SR-43: never asks on mount. The OS prompt comes from a tap after the reason is on screen, and a
  // blocked permission shows the route to system settings instead of a button that does nothing.
  const camera = useCameraAccess(log);
  const device = useCameraDevice('back');
  const preview = usePreviewOutput();
  const model = frameModel.state === 'loaded' ? frameModel.loaded.model : undefined;
  const jpegModel = stillModel.state === 'loaded' ? stillModel.loaded.model : undefined;

  const [enrolling, setEnrolling] = useState(false);
  /** SR-06: the product whose price editor is open, bound when its price was tapped. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId !== null;
  const [frameError, setFrameError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  /** SR-10: the pinned quick-pick grid, opened from its button rather than by a lock. */
  const [gridOpen, setGridOpen] = useState(false);
  /** SR-44: the guided flow is on until five live products exist. */
  const guided = firstRun.kind !== 'complete';

  // One capture channel, set from JS and read by the worklet on its next processed frame. Only one
  // panel is open at a time, so the owner says where the capture goes.
  const captureRequest = useMemo(() => createSynchronizable(false), []);
  const captureOwner = useRef<'enroll' | 'reject' | 'teach'>('enroll');
  const requestEnrollCapture = useCallback(() => {
    captureOwner.current = 'enroll';
    captureRequest.setBlocking(true);
  }, [captureRequest]);
  const requestRejectCapture = useCallback(() => {
    captureOwner.current = 'reject';
    captureRequest.setBlocking(true);
  }, [captureRequest]);
  const requestTeachCapture = useCallback(() => {
    captureOwner.current = 'teach';
    captureRequest.setBlocking(true);
  }, [captureRequest]);

  const enrollment = useEnrollment({ catalog, indexRef, stillModel: jpegModel, requestFrameCapture: requestEnrollCapture, log });
  useEffect(() => {
    if (enrollment.savedCount > 0) bumpCatalogVersion();
  }, [enrollment.savedCount, bumpCatalogVersion]);

  // The gate check section shows these (ARCHITECTURE.md §4). Session-only, like the hook state it mirrors.
  useEffect(() => {
    diagnostics.enrollmentMeasurements.current = enrollment.measurements;
  }, [enrollment.measurements, diagnostics]);

  const scanner = useScanner({
    catalog,
    catalogVersion,
    indexRef,
    timingsRef: diagnostics.scanTimings,
    lockLogRef: diagnostics.lockLog,
  });
  const { onVector, reset: resetScanner } = scanner;

  const rejection = useRejection({
    catalog,
    indexRef,
    lastTop: scanner.lastTop,
    stillModel: jpegModel,
    requestFrameCapture: requestRejectCapture,
    classify: scanner.classify,
    rebuildIndex,
    onCatalogChanged: bumpCatalogVersion,
    log,
  });
  const rejecting = rejection.state.stage !== 'idle';

  const teach = useTeach({
    catalog,
    indexRef,
    stillModel: jpegModel,
    requestFrameCapture: requestTeachCapture,
    rebuildIndex,
    onCatalogChanged: bumpCatalogVersion,
    log,
  });
  const teaching = teach.productId !== null;

  const undoDelete = useUndoDelete({ catalog, rebuildIndex, onCatalogChanged: bumpCatalogVersion, log });

  const pausedRef = useRef(false);
  pausedRef.current = enrolling || rejecting || editing || gridOpen || teaching;
  const receivers = useRef({ enroll: enrollment.receiveCapture, reject: rejection.receiveCapture, teach: teach.receiveCapture });
  receivers.current = { enroll: enrollment.receiveCapture, reject: rejection.receiveCapture, teach: teach.receiveCapture };

  // A fresh stability window whenever scanning pauses or resumes, and after every catalog write
  // (enrollment, price edit, delete, restore, negative, correction, taught photo). A lock must never
  // mix votes from before a pause, or from two different indexes (P2-4).
  useEffect(() => {
    resetScanner();
  }, [enrolling, rejecting, editing, gridOpen, teaching, focused, catalogVersion, resetScanner]);

  // SR-11. Off whenever the tab loses focus: a torch left on in a pocket drains the battery (NFR-06).
  useEffect(() => {
    if (!focused) setTorch(false);
  }, [focused]);

  const liveProductCount = useMemo(() => catalogCounts(catalog.db).products, [catalog, catalogVersion]);
  // SR-10: the grid's tiles and whether its pinned button shows. Re-read after every catalog write,
  // because enrollment, a price edit, delete and restore can each change them.
  const repacked = useMemo(() => listQuickPickProducts(catalog.db), [catalog, catalogVersion]);
  useEffect(() => {
    if (repacked.length === 0) setGridOpen(false);
  }, [repacked]);
  // The sheet's name search. Read only while the sheet is open.
  const searchable = useMemo(() => (rejecting ? listProducts(catalog.db) : []), [catalog, catalogVersion, rejecting]);

  const onEmbedding = useCallback(
    (result: FrameEmbedding) => {
      const timings = diagnostics.workletTimings;
      timings.current = [...timings.current.slice(-(WORKLET_TIMING_WINDOW - 1)), result.timings];
      if (!pausedRef.current) onVector(result.vector);
    },
    [onVector, diagnostics],
  );

  const onReference = useCallback(
    (capture: ReferenceCapture) => {
      onEmbedding(capture.embedding);
      receivers.current[captureOwner.current](capture);
    },
    [onEmbedding],
  );

  const onFrameError = useCallback((message: string) => {
    setFrameError((previous) => (previous === message ? previous : message));
  }, []);

  const openEnrollment = useCallback(
    (source: AddSource) => {
      log(ADD_KINDS[source], []);
      setEnrolling(true);
    },
    [log],
  );
  const openFromButton = useCallback(() => openEnrollment('button'), [openEnrollment]);
  const openFromUnknown = useCallback(() => openEnrollment('unknown'), [openEnrollment]);
  const openFromBanner = useCallback(() => openEnrollment('banner'), [openEnrollment]);
  const closeEnrollment = useCallback(() => {
    // In the guided flow this button reads *Finish later*, and the choice is saved (SR-44).
    if (guided) finishFirstRunLater();
    log('enrollClosed', []);
    setEnrolling(false);
  }, [guided, finishFirstRunLater, log]);
  const tryScanning = useCallback(() => {
    log('tryScanning', []);
    log('enrollClosed', []);
    setEnrolling(false);
  }, [log]);

  // The first-run intro handed over: open the guided add once (Root.consumeGuidedStart).
  useEffect(() => {
    if (consumeGuidedStart()) openEnrollment('firstRun');
  }, [consumeGuidedStart, openEnrollment]);

  // SR-33: *Teach again* asked for on the Directory. It takes over the panel: an enrollment draft
  // stays in its hook for when Add is tapped again, and an open reject sheet or price editor closes,
  // since both were pinned to a lock that is no longer on screen.
  const closeRejection = rejection.close;
  const startTeach = teach.start;
  useEffect(() => {
    const productId = consumeTeachRequest();
    if (productId === null) return;
    setEnrolling(false);
    setEditingId(null);
    setGridOpen(false);
    closeRejection();
    startTeach(productId);
  }, [teachVersion, consumeTeachRequest, closeRejection, startTeach]);

  // SR-34: a chip or tile the tindera picks counts as scanned, once per tap. Locks are stamped in useScanner.
  const logOverlay = useCallback(
    (kind: InteractionKind, productIds: readonly string[]) => {
      log(kind, productIds);
      if (kind === 'chipPick' || kind === 'tilePick') {
        try {
          markScanned(catalog.db, productIds);
        } catch {
          // A sort hint; never worth failing the tap.
        }
      }
    },
    [catalog, log],
  );

  const toggleTorch = useCallback(() => {
    log(torch ? 'torchOff' : 'torchOn', []);
    setTorch(!torch);
  }, [log, torch]);

  const openPriceEditor = useCallback(
    (productId: string) => {
      log('priceEditOpen', [productId]);
      setEditingId(productId);
    },
    [log],
  );
  const openGrid = useCallback(() => {
    log('gridOpen', []);
    setGridOpen(true);
  }, [log]);
  const closeGrid = useCallback(() => {
    log('gridClose', []);
    setGridOpen(false);
  }, [log]);

  const closePriceEditor = useCallback(() => setEditingId(null), []);
  const onPriceSaved = useCallback(() => {
    bumpCatalogVersion();
    setEditingId(null);
  }, [bumpCatalogVersion]);
  const deleteProduct = useCallback(
    (productId: string) => {
      undoDelete.remove(productId);
      setEditingId(null);
    },
    [undoDelete.remove],
  );

  // TR-26: throttle inside the worklet. Holding the interval on the camera thread is what makes the
  // dropped frames actually free — bouncing to JS to decide whether to skip would defeat the point.
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

  if (!camera.hasPermission) {
    return (
      <Centered>
        <CameraAccessPanel access={camera} />
      </Centered>
    );
  }
  if (device == null) {
    return (
      <Centered>
        <Text style={styles.info}>{t('camera.none')}</Text>
      </Centered>
    );
  }
  if (frameModel.state === 'error') {
    return (
      <Centered>
        <Text style={styles.info}>{t('app.modelError')}</Text>
        <Text style={styles.error}>{frameModel.error}</Text>
      </Centered>
    );
  }
  if (model == null) {
    return (
      <Centered>
        <ActivityIndicator color="#ffffff" />
        <Text style={styles.info}>{t('app.loading')}</Text>
      </Centered>
    );
  }

  const panelOpen = enrolling || rejecting || editing || teaching;

  return (
    <View style={styles.root}>
      <View style={styles.cameraWrap}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={focused}
          outputs={outputs}
          torchMode={torch && device.hasTorch ? 'on' : 'off'}
        />
        <View pointerEvents="none" style={styles.reticleLayer}>
          <View style={styles.reticle} />
        </View>
        {!enrolling && !teaching && device.hasTorch && (
          <Pressable onPress={toggleTorch} style={[styles.topButton, styles.torchButton, torch && styles.torchOn, { top: insets.top + 12 }]}>
            <Text style={[styles.topButtonText, torch && styles.torchOnText]}>{t(torch ? 'scan.torchTurnOff' : 'scan.torchTurnOn')}</Text>
          </Pressable>
        )}
        {!panelOpen && (
          <>
            <Pressable onPress={openFromButton} style={[styles.topButton, styles.addButton, { top: insets.top + 12 }]}>
              <Text style={styles.topButtonText}>{t('scan.addProduct')}</Text>
            </Pressable>
            {!gridOpen && repacked.length > 0 && (
              <Pressable onPress={openGrid} style={[styles.topButton, styles.gridButton, { top: insets.top + 64 }]}>
                <Text style={styles.topButtonText}>{t('scan.quickPick.open')}</Text>
              </Pressable>
            )}
            {guided && (
              <Pressable onPress={openFromBanner} style={[styles.banner, { top: insets.top + 64 }]}>
                <Text style={styles.bannerCount}>{t('firstRun.banner', { done: liveProductCount, target: FIRST_RUN_TARGET })}</Text>
                <Text style={styles.bannerAction}>{t('firstRun.addNext')}</Text>
              </Pressable>
            )}
            <ScanOverlay
              locked={scanner.locked}
              liveProductCount={liveProductCount}
              confirmBelow={catalog.meta.confirmBelow}
              thresholds={catalog.meta.thresholds}
              productOf={scanner.productOf}
              photoOf={scanner.photoOf}
              repacked={repacked}
              gridOpen={gridOpen}
              onCloseGrid={closeGrid}
              onAdd={openFromUnknown}
              onReject={rejection.reject}
              onEditPrice={openPriceEditor}
              onLog={logOverlay}
            />
          </>
        )}
        {(undoDelete.pending !== null || undoDelete.rebuildError !== null) && (
          <View style={[styles.undoBar, { top: insets.top + 116 }]}>
            {undoDelete.rebuildError !== null ? (
              <Pressable onPress={undoDelete.dismissError} style={styles.undoTextWrap}>
                <Text style={styles.error}>{t('scan.undo.rebuildFailed', { message: undoDelete.rebuildError })}</Text>
              </Pressable>
            ) : (
              <Text style={[styles.undoText, styles.undoTextWrap]} numberOfLines={2}>
                {t('scan.undo.deleted', { name: undoDelete.pending?.name ?? '' })}
              </Text>
            )}
            {undoDelete.pending !== null && (
              <Pressable onPress={undoDelete.undo} style={styles.undoButton}>
                <Text style={styles.undoButtonText}>{t('scan.undo.undo')}</Text>
              </Pressable>
            )}
          </View>
        )}
        {frameError !== null && (
          <Text style={[styles.frameError, { top: insets.top + 184 }]}>{t('scan.frameError', { message: frameError })}</Text>
        )}
      </View>

      {panelOpen && (
        <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">
          {enrolling && (
            <>
              <Pressable onPress={closeEnrollment} style={styles.closeButton}>
                <Text style={styles.closeText}>{t(guided ? 'enroll.guided.later' : 'enroll.close')}</Text>
              </Pressable>
              <EnrollmentPanel enrollment={enrollment} guidedDone={guided ? liveProductCount : null} onTryScanning={tryScanning} />
            </>
          )}
          {!enrolling && teaching && <TeachPanel teach={teach} />}
          {!enrolling && !teaching && editingId !== null && (
            <PriceEditPanel
              key={editingId}
              catalog={catalog}
              productId={editingId}
              onClose={closePriceEditor}
              onSaved={onPriceSaved}
              onDelete={deleteProduct}
              log={log}
            />
          )}
          {!enrolling && !teaching && !editing && rejecting && (
            <RejectPanel rejection={rejection} productOf={scanner.productOf} products={searchable} />
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={[styles.root, styles.centered]}>{children}</View>;
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
  topButton: { position: 'absolute', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  addButton: { right: 12, backgroundColor: 'rgba(43, 108, 176, 0.95)' },
  torchButton: { left: 12, backgroundColor: 'rgba(27, 36, 48, 0.9)' },
  gridButton: { left: 12, backgroundColor: 'rgba(47, 133, 90, 0.95)' },
  torchOn: { backgroundColor: '#ffd166' },
  topButtonText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  torchOnText: { color: '#0b0f14' },
  banner: {
    position: 'absolute',
    right: 12,
    maxWidth: '58%',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(11, 15, 20, 0.9)',
    borderColor: '#ffd166',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  bannerCount: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  bannerAction: { color: '#ffd166', fontSize: 16, fontWeight: '800' },
  undoBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(11, 15, 20, 0.94)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  undoTextWrap: { flex: 1 },
  undoText: { color: '#ffffff', fontSize: 16 },
  undoButton: { backgroundColor: '#ffd166', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18 },
  undoButtonText: { color: '#0b0f14', fontWeight: '800', fontSize: 18 },
  frameError: { position: 'absolute', left: 12, right: 12, color: '#ff6b6b', fontSize: 12 },
  panel: { maxHeight: '55%', backgroundColor: '#0b0f14' },
  panelContent: { padding: 14, gap: 10, paddingBottom: 32 },
  closeButton: { alignSelf: 'flex-start', paddingVertical: 6 },
  closeText: { color: '#ffd166', fontWeight: '700' },
  info: { color: '#ffffff', textAlign: 'center' },
  error: { color: '#ff6b6b', fontSize: 12, textAlign: 'center' },
});
