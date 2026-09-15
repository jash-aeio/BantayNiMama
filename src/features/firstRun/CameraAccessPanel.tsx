import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CameraAccess } from './useCameraAccess';

// Why the camera is needed, and the way back when it was refused (SR-43). The first-run flow's camera
// step and the Scan tab both show this, so the recovery screen is the same wherever a denial happens.

const BODY_KEYS = { ask: 'camera.why', askAgain: 'camera.askAgain', openSettings: 'camera.blocked' } as const;

export function CameraAccessPanel({ access }: { access: CameraAccess }) {
  const { t } = useTranslation();
  if (access.view === 'granted') return null;
  const blocked = access.view === 'openSettings';
  return (
    <View style={styles.root}>
      <Text style={styles.body}>{t(BODY_KEYS[access.view])}</Text>
      <Pressable onPress={blocked ? access.openSettings : access.ask} style={styles.button}>
        <Text style={styles.buttonText}>{t(blocked ? 'camera.openSettings' : 'camera.grant')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 16, alignSelf: 'stretch' },
  body: { color: '#ffffff', fontSize: 18, lineHeight: 26, textAlign: 'center' },
  button: { backgroundColor: '#2b6cb0', borderRadius: 10, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontWeight: '800', fontSize: 18 },
});
