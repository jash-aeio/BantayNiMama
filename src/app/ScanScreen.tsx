import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  usePreviewOutput,
} from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

import { EnrollmentPanel } from '../features/enrollment/EnrollmentPanel';
import { useEnrollment } from '../features/enrollment/useEnrollment';
import { ScanOverlay } from '../features/scanner/ScanOverlay';
import { useScanner } from '../features/scanner/useScanner';
import { captureReference, embedFrame, type FrameEmbedding, type ReferenceCapture } from '../ml/frameEmbedder';
import { RETICLE_FRACTION, TARGET_FPS } from '../ml/model';
import { useAppServices } from './services';

/** How many recent frames the worklet timing samples cover. */
const WORKLET_TIMING_WINDOW = 40;

/**
 * The Scan tab: one camera for both scanning and enrollment (operator's choice, P1-7).
 *
 * Enrollment slides up under the live preview rather than opening a second screen. A second camera
 * with its own frame processor would need the scanner's stopped first, and SR-05 asks that Add
 * never blocks the preview. The camera is active only while this tab is focused, so the Products
 * tab costs no inference (NFR-06).
 */
export function ScanScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { catalog, indexRef, frameModel, stillModel, diagnostics, bumpCatalogVersion } = useAppServices();
  const focused = useIsFocused();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const preview = usePreviewOutput();
  const model = frameModel.state === 'loaded' ? frameModel.loaded.model : undefined;
  const jpegModel = stillModel.state === 'loaded' ? stillModel.loaded.model : undefined;

  const [enrolling, setEnrolling] = useState(false);
  const enrollingRef = useRef(enrolling);
  enrollingRef.current = enrolling;
  const [frameError, setFrameError] = useState<string | null>(null);

  // Set from JS, read by the worklet on its next processed frame.
  const captureRequest = useMemo(() => createSynchronizable(false), []);
  const requestFrameCapture = useCallback(() => captureRequest.setBlocking(true), [captureRequest]);

  const enrollment = useEnrollment({ catalog, indexRef, stillModel: jpegModel, requestFrameCapture });
  const receiveCapture = useRef(enrollment.receiveCapture);
  receiveCapture.current = enrollment.receiveCapture;
  useEffect(() => {
    if (enrollment.savedCount > 0) bumpCatalogVersion();
  }, [enrollment.savedCount, bumpCatalogVersion]);

  // The gate check section shows these: frame-vs-JPEG agreement on real products is owed before
  // P1-8 (ARCHITECTURE.md §4). Session-only, like the hook state it mirrors.
  useEffect(() => {
    diagnostics.enrollmentMeasurements.current = enrollment.measurements;
  }, [enrollment.measurements, diagnostics]);

  const scanner = useScanner({ catalog, indexRef, timingsRef: diagnostics.scanTimings });
  const { onVector, reset: resetScanner } = scanner;

  // A fresh stability window whenever scanning resumes, so a lock never carries votes from before
  // the pause — or from before a product existed.
  useEffect(() => {
    resetScanner();
  }, [enrolling, focused, resetScanner]);

  const onEmbedding = useCallback(
    (result: FrameEmbedding) => {
      const timings = diagnostics.workletTimings;
      timings.current = [...timings.current.slice(-(WORKLET_TIMING_WINDOW - 1)), result.timings];
      if (!enrollingRef.current) onVector(result.vector);
    },
    [onVector, diagnostics],
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

  const openEnrollment = useCallback(() => setEnrolling(true), []);
  const closeEnrollment = useCallback(() => setEnrolling(false), []);

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

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

  if (!hasPermission) {
    return (
      <Centered>
        <Text style={styles.info}>{t('camera.permissionNeeded')}</Text>
        <Pressable onPress={() => void requestPermission()} style={styles.button}>
          <Text style={styles.buttonText}>{t('camera.grant')}</Text>
        </Pressable>
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

  return (
    <View style={styles.root}>
      <View style={styles.cameraWrap}>
        <Camera style={StyleSheet.absoluteFill} device={device} isActive={focused} outputs={outputs} />
        <View pointerEvents="none" style={styles.reticleLayer}>
          <View style={styles.reticle} />
        </View>
        {!enrolling && (
          <>
            <Pressable onPress={openEnrollment} style={[styles.addButton, { top: insets.top + 12 }]}>
              <Text style={styles.addButtonText}>{t('scan.addProduct')}</Text>
            </Pressable>
            <ScanOverlay
              locked={scanner.locked}
              thresholds={catalog.meta.thresholds}
              productOf={scanner.productOf}
              onAdd={openEnrollment}
            />
          </>
        )}
        {frameError !== null && (
          <Text style={[styles.frameError, { top: insets.top + 64 }]}>{t('scan.frameError', { message: frameError })}</Text>
        )}
      </View>

      {enrolling && (
        <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">
          <Pressable onPress={closeEnrollment} style={styles.closeButton}>
            <Text style={styles.closeText}>{t('enroll.close')}</Text>
          </Pressable>
          <EnrollmentPanel enrollment={enrollment} />
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
  addButton: {
    position: 'absolute',
    right: 12,
    backgroundColor: 'rgba(43, 108, 176, 0.95)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  addButtonText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  frameError: { position: 'absolute', left: 12, right: 12, color: '#ff6b6b', fontSize: 12 },
  panel: { maxHeight: '55%', backgroundColor: '#0b0f14' },
  panelContent: { padding: 14, gap: 10, paddingBottom: 32 },
  closeButton: { alignSelf: 'flex-start', paddingVertical: 6 },
  closeText: { color: '#ffd166', fontWeight: '700' },
  info: { color: '#ffffff', textAlign: 'center' },
  error: { color: '#ff6b6b', fontSize: 12, textAlign: 'center' },
  button: { backgroundColor: '#2b6cb0', borderRadius: 6, paddingVertical: 12, paddingHorizontal: 20 },
  buttonText: { color: '#ffffff', fontWeight: '700' },
});
