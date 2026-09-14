import '../i18n';

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { getLocales } from 'expo-localization';
import { StatusBar } from 'expo-status-bar';
import i18next from 'i18next';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { openCatalog, type Catalog } from '../db/catalog';
import { readMetaValue, writeMetaValue } from '../db/meta';
import { loadVectorIndex } from '../db/shots';
import { appendInteraction, type Interaction, type InteractionKind } from '../domain/interactionLog.ts';
import type { VectorIndex } from '../domain/knn.ts';
import { resolveLanguage, UI_LANGUAGE_META_KEY, type Language } from '../domain/language.ts';
import type { LockEvent } from '../domain/lockLog.ts';
import type { ShotMeasurement } from '../features/enrollment/useEnrollment';
import type { ScanTiming } from '../features/scanner/useScanner';
import type { StageTimings } from '../ml/frameEmbedder';
import { useEmbeddingModel } from '../ml/useEmbeddingModel';
import { ProductsScreen } from './ProductsScreen';
import { ScanScreen } from './ScanScreen';
import { AppServicesContext, type AppServices, type IndexRebuild, type IndexRebuildReason } from './services';

// App shell — TR-14 as amended by ADR-015: two bottom tabs on React Navigation, Scan and Products.

/** Rebuilds kept for the gate panel. Deletes and restores are rare taps. */
const INDEX_REBUILD_LOG = 50;

type TabParams = { Scan: undefined; Products: undefined };

const Tab = createBottomTabNavigator<TabParams>();

const THEME: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: '#0b0f14', card: '#0b0f14', primary: '#ffd166', border: '#1b2430' },
};

type Boot = { ok: true; catalog: Catalog; language: Language } | { ok: false; error: string };

function deviceLanguageCodes(): (string | null)[] {
  try {
    return getLocales().map((locale) => locale.languageCode);
  } catch {
    return [];
  }
}

/**
 * Once per launch, before anything renders. The orphan-photo sweep inside openCatalog relies on
 * no enrollment draft existing yet, and the language is set before the first frame of copy.
 */
function boot(): Boot {
  try {
    const catalog = openCatalog();
    const language = resolveLanguage(readMetaValue(catalog.db, UI_LANGUAGE_META_KEY), deviceLanguageCodes());
    void i18next.changeLanguage(language);
    return { ok: true, catalog, language };
  } catch (e) {
    // No catalog means no saved choice: show the error in the phone's language.
    void i18next.changeLanguage(resolveLanguage(null, deviceLanguageCodes()));
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default function Root() {
  const [booted] = useState(boot);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {booted.ok ? <Shell catalog={booted.catalog} initialLanguage={booted.language} /> : <CatalogError message={booted.error} />}
    </SafeAreaProvider>
  );
}

function Shell({ catalog, initialLanguage }: { catalog: Catalog; initialLanguage: Language }) {
  const { t } = useTranslation();
  const indexRef = useRef<VectorIndex>(catalog.index);
  const frameModel = useEmbeddingModel('cpu');
  const stillModel = useEmbeddingModel('cpu');
  const workletTimings = useRef<readonly StageTimings[]>([]);
  const scanTimings = useRef<readonly ScanTiming[]>([]);
  const enrollmentMeasurements = useRef<readonly ShotMeasurement[]>([]);
  const lockLog = useRef<readonly LockEvent[]>([]);
  const interactionLog = useRef<readonly Interaction[]>([]);
  const indexRebuilds = useRef<readonly IndexRebuild[]>([]);
  const diagnostics = useMemo(
    () => ({ workletTimings, scanTimings, enrollmentMeasurements, lockLog, interactionLog, indexRebuilds }),
    [],
  );

  const logInteraction = useCallback((kind: InteractionKind, productIds: readonly string[]) => {
    interactionLog.current = appendInteraction(interactionLog.current, { atMs: Date.now(), kind, productIds });
  }, []);

  // E-4: a rebuild is the whole index read again, so no splice code can leave a trashed product's
  // rows searchable. It swaps the ref between two frames, because the JS thread runs one at a time.
  const rebuildIndex = useCallback(
    (reason: IndexRebuildReason) => {
      const t0 = performance.now();
      const { index } = loadVectorIndex(catalog.db, catalog.meta);
      const ms = performance.now() - t0;
      indexRef.current = index;
      const record: IndexRebuild = { atMs: Date.now(), ms, size: index.size, reason };
      indexRebuilds.current = [...indexRebuilds.current.slice(-(INDEX_REBUILD_LOG - 1)), record];
      return record;
    },
    [catalog],
  );

  const [language, setLanguageState] = useState(initialLanguage);
  const setLanguage = useCallback(
    (next: Language) => {
      writeMetaValue(catalog.db, UI_LANGUAGE_META_KEY, next);
      void i18next.changeLanguage(next);
      setLanguageState(next);
    },
    [catalog],
  );

  const [catalogVersion, setCatalogVersion] = useState(0);
  const bumpCatalogVersion = useCallback(() => setCatalogVersion((n) => n + 1), []);

  const services = useMemo<AppServices>(
    () => ({
      catalog,
      indexRef,
      frameModel,
      stillModel,
      language,
      setLanguage,
      catalogVersion,
      bumpCatalogVersion,
      rebuildIndex,
      logInteraction,
      diagnostics,
    }),
    [catalog, frameModel, stillModel, language, setLanguage, catalogVersion, bumpCatalogVersion, rebuildIndex, logInteraction, diagnostics],
  );

  return (
    <AppServicesContext.Provider value={services}>
      <NavigationContainer theme={THEME}>
        <Tab.Navigator
          screenOptions={{
            // Text-only tabs, with no icon library to audit. The icon slot must be removed, not just
            // left empty: an empty slot pushes a 16 sp label below the bar's content area, under
            // Android's navigation-bar scrim (seen on the Infinix, P1-7).
            tabBarIconStyle: { display: 'none' },
            tabBarLabelPosition: 'beside-icon',
            tabBarActiveTintColor: '#ffd166',
            tabBarInactiveTintColor: '#9aa5b1',
            tabBarLabelStyle: { fontSize: 16, fontWeight: '700' },
            headerTintColor: '#ffffff',
          }}
        >
          <Tab.Screen name="Scan" component={ScanScreen} options={{ title: t('tabs.scan'), headerShown: false }} />
          <Tab.Screen name="Products" component={ProductsScreen} options={{ title: t('tabs.products') }} />
        </Tab.Navigator>
      </NavigationContainer>
    </AppServicesContext.Provider>
  );
}

function CatalogError({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.centered}>
      <Text style={styles.title}>{t('app.catalogError')}</Text>
      <Text style={styles.detail}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, backgroundColor: '#0b0f14', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  detail: { color: '#ff6b6b', fontSize: 12, textAlign: 'center' },
});
