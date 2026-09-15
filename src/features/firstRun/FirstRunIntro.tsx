import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppServices } from '../../app/services';
import { readMetaValue, writeMetaValue } from '../../db/meta';
import { FIRST_RUN_INTRO_AT_CAMERA, FIRST_RUN_INTRO_META_KEY, introStartStep, type IntroStep } from '../../domain/firstRun.ts';
import { LANGUAGES, type Language } from '../../domain/language.ts';
import { CameraAccessPanel } from './CameraAccessPanel';
import { useCameraAccess } from './useCameraAccess';

// First run on an empty catalog (SR-44, PHASE_2_PLAN P2-6): welcome → language → why the camera →
// the OS prompt, or the recovery screen. It replaces the tabs, so no camera or scanner runs until the
// camera is granted. The guided add ×5 then opens on the Scan tab, which already owns the camera.
//
// Reaching the camera step is saved in app_meta. Android can kill the app while she is in system
// settings (seen on the Infinix, P2-6 attempt 1), and the relaunch must resume there (introStartStep).

const LANGUAGE_LABEL_KEYS = { en: 'settings.english', fil: 'settings.filipino' } as const satisfies Record<Language, string>;

interface Props {
  /** The camera is granted: open the tabs and start the guided add. */
  readonly onStart: () => void;
  /** *Finish later*: open the tabs with the 0 of 5 banner, and save the dismissal. */
  readonly onFinishLater: () => void;
}

export function FirstRunIntro({ onStart, onFinishLater }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { catalog, language, setLanguage, logInteraction } = useAppServices();
  const [step, setStep] = useState<IntroStep>(() => introStartStep(readMetaValue(catalog.db, FIRST_RUN_INTRO_META_KEY)));
  const camera = useCameraAccess(logInteraction);

  // Gate B1 evidence that a relaunch resumed rather than replayed. Logged once per mount.
  const resumed = useRef(step === 'camera');
  useEffect(() => {
    if (resumed.current) logInteraction('introResumedAtCamera', []);
  }, [logInteraction]);

  // Gate B1: "after the grant the app returns to the flow". A grant seen on the camera step moves on by
  // itself, whether it came from the OS prompt, on return from system settings, or on a relaunch.
  useEffect(() => {
    if (step === 'camera' && camera.hasPermission) onStart();
  }, [step, camera.hasPermission, onStart]);

  const pickLanguage = (next: Language) => {
    logInteraction('introLanguage', []);
    setLanguage(next);
  };

  const goToCamera = () => {
    writeMetaValue(catalog.db, FIRST_RUN_INTRO_META_KEY, FIRST_RUN_INTRO_AT_CAMERA);
    setStep('camera');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
      {step === 'welcome' && (
        <>
          <View style={styles.main}>
            <Text style={styles.title}>{t('firstRun.welcome.title')}</Text>
            <Text style={styles.body}>{t('firstRun.welcome.body')}</Text>
          </View>
          <Pressable onPress={() => setStep('language')} style={styles.primary}>
            <Text style={styles.primaryText}>{t('firstRun.welcome.start')}</Text>
          </Pressable>
          <Pressable onPress={onFinishLater} style={styles.secondary}>
            <Text style={styles.secondaryText}>{t('firstRun.welcome.later')}</Text>
          </Pressable>
        </>
      )}

      {step === 'language' && (
        <>
          <View style={styles.main}>
            <Text style={styles.title}>{t('firstRun.language.title')}</Text>
            {LANGUAGES.map((l) => (
              <Pressable key={l} onPress={() => pickLanguage(l)} style={[styles.choice, language === l && styles.choiceActive]}>
                <Text style={[styles.choiceText, language === l && styles.choiceTextActive]}>{t(LANGUAGE_LABEL_KEYS[l])}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={goToCamera} style={styles.primary}>
            <Text style={styles.primaryText}>{t('firstRun.language.next')}</Text>
          </Pressable>
        </>
      )}

      {step === 'camera' && (
        <View style={styles.main}>
          <Text style={styles.title}>{t('firstRun.camera.title')}</Text>
          <CameraAccessPanel access={camera} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f14', paddingHorizontal: 24, gap: 12 },
  main: { flex: 1, justifyContent: 'center', gap: 20 },
  title: { color: '#ffffff', fontSize: 28, fontWeight: '800', textAlign: 'center' },
  body: { color: '#e6eaef', fontSize: 18, lineHeight: 26, textAlign: 'center' },
  primary: { backgroundColor: '#2b6cb0', borderRadius: 10, paddingVertical: 16, alignItems: 'center' },
  primaryText: { color: '#ffffff', fontWeight: '800', fontSize: 18 },
  secondary: { paddingVertical: 14, alignItems: 'center' },
  secondaryText: { color: '#9ec5fe', fontWeight: '700', fontSize: 16 },
  choice: { backgroundColor: '#1b2430', borderRadius: 10, paddingVertical: 18, alignItems: 'center' },
  choiceActive: { backgroundColor: '#ffd166' },
  choiceText: { color: '#ffffff', fontWeight: '700', fontSize: 20 },
  choiceTextActive: { color: '#0b0f14' },
});
