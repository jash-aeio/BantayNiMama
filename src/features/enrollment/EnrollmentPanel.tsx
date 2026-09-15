import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { resolvePhotoPath } from '../../db/photos';
import {
  MAX_SHOTS,
  MIN_SHOTS,
  parseEnrollmentForm,
  repackedPlan,
  type EnrollmentForm,
  type FormError,
  type NewProduct,
} from '../../domain/enrollment.ts';
import { afterGuidedSave, FIRST_RUN_TARGET, nextShotAngle, type ShotAngle } from '../../domain/firstRun.ts';
import { formatCentavos } from '../../domain/money.ts';
import type { QualityWarning } from '../../domain/shotQuality.ts';
import type { EnrollmentState } from './useEnrollment';

// Enrollment (SR-20, SR-21, SR-23), with P2-5's *repacked* toggle (SR-10) and P2-6's guidance:
// - photos first, then the form. The camera is already on the item when Add is tapped, and the
//   duplicate warning (SR-23) then appears before she types a name for something already listed;
// - the framing coach, and one angle or light change per photo (SR-20, ADR-006);
// - quality warnings per photo, which never block (SR-22; the limits are placeholders);
// - in the guided flow, *Item n of 5*, what comes after each save (SR-44), and only SR-21's required
//   fields in view. Gate B2 attempt 2 took 38–56 s per product against SR-25's 30 s; pack price, unit
//   and category are optional, so they wait behind *More details* (operator's call). The *repacked*
//   toggle stays in view: a clear bag saved without it can be named as another bag (ADR-018).

const EMPTY_FORM: EnrollmentForm = { name: '', pricePiece: '', pricePack: '', unitLabel: '', category: '' };

const FORM_ERROR_KEYS = {
  nameRequired: 'enroll.errors.nameRequired',
  piecePriceRequired: 'enroll.errors.piecePriceRequired',
  piecePriceInvalid: 'enroll.errors.piecePriceInvalid',
  packPriceInvalid: 'enroll.errors.packPriceInvalid',
} as const satisfies Record<FormError, string>;

const ANGLE_KEYS = {
  front: 'enroll.angle.front',
  turnLeft: 'enroll.angle.turnLeft',
  turnRight: 'enroll.angle.turnRight',
  backOrTop: 'enroll.angle.backOrTop',
  otherLight: 'enroll.angle.otherLight',
} as const satisfies Record<ShotAngle, string>;

const QUALITY_KEYS = {
  tooDark: 'enroll.quality.tooDark',
  blownOut: 'enroll.quality.blownOut',
  blurred: 'enroll.quality.blurred',
} as const satisfies Record<QualityWarning, string>;

type Notice = { readonly tone: 'ok' | 'error'; readonly text: string; readonly tryScanning?: boolean } | null;

interface Props {
  readonly enrollment: EnrollmentState;
  /** Live products while the guided flow is on (fewer than five), else null. */
  readonly guidedDone: number | null;
  /** *Try scanning it*, offered after the first product: closes the panel. */
  readonly onTryScanning: () => void;
}

export const EnrollmentPanel = memo(function EnrollmentPanel({ enrollment, guidedDone, onTryScanning }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<EnrollmentForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<readonly FormError[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [repacked, setRepacked] = useState(false);
  // SR-23's hint: off by default, because L-02 size pairs trip the same warning (PHASE_2_PLAN P2-5).
  const [markDuplicates, setMarkDuplicates] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const { shots, capturing, error, duplicates } = enrollment;
  const duplicateNames = duplicates.map((d) => d.name).join(', ');
  const plan = repackedPlan(repacked, markDuplicates, duplicates.map((d) => d.id));
  const angle = nextShotAngle(shots.length);
  const guided = guidedDone !== null;
  // Typed values stay in the form while hidden, so collapsing never loses a pack price.
  const showOptional = !guided || moreOpen;

  const field = (key: keyof EnrollmentForm) => (text: string) => {
    enrollment.noteTyping();
    setForm((previous) => ({ ...previous, [key]: text }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setErrors([]);
    setRepacked(false);
    setMarkDuplicates(false);
    setMoreOpen(false);
  };

  const savedNotice = (product: NewProduct): Notice => {
    if (guidedDone === null) {
      const price = formatCentavos(product.pricePiece);
      return { tone: 'ok', text: t(product.isAmbiguous === true ? 'enroll.savedRepacked' : 'enroll.saved', { name: product.name, price }) };
    }
    // guidedDone was read before this save, so the new product makes it one more.
    const done = guidedDone + 1;
    switch (afterGuidedSave(done)) {
      case 'tryScanning':
        return { tone: 'ok', text: t('enroll.guided.savedTry', { name: product.name }), tryScanning: true };
      case 'next':
        return { tone: 'ok', text: t('enroll.guided.savedNext', { name: product.name, done, target: FIRST_RUN_TARGET }) };
      case 'complete':
        return { tone: 'ok', text: t('enroll.guided.complete', { target: FIRST_RUN_TARGET }) };
    }
  };

  const commit = (product: NewProduct, markAmbiguous: readonly string[]) => {
    const result = enrollment.save(product, markAmbiguous);
    if (result.ok) {
      resetForm();
      setNotice(savedNotice(product));
    } else {
      setNotice({ tone: 'error', text: t('enroll.errors.saveFailed', { message: result.message }) });
    }
  };

  const onSave = () => {
    const parsed = parseEnrollmentForm(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      // A bad pack price must be visible to be fixed.
      if (parsed.errors.includes('packPriceInvalid')) setMoreOpen(true);
      setNotice(null);
      return;
    }
    setErrors([]);
    if (shots.length < MIN_SHOTS) {
      setNotice({ tone: 'error', text: t('enroll.errors.needShots', { min: MIN_SHOTS }) });
      return;
    }
    const product: NewProduct = { ...parsed.product, isAmbiguous: plan.isAmbiguous };
    // SR-23 warns but never blocks: a size variant (L-02) is supposed to look like its sibling. Marking
    // the look-alikes as repacked already answers "is it in your list?", so that skips the alert.
    if (duplicates.length > 0 && plan.markAmbiguous.length === 0) {
      Alert.alert(t('enroll.duplicate.title'), t('enroll.duplicate.body', { names: duplicateNames }), [
        { text: t('enroll.duplicate.cancel'), style: 'cancel' },
        { text: t('enroll.duplicate.saveAnyway'), onPress: () => commit(product, []) },
      ]);
      return;
    }
    commit(product, plan.markAmbiguous);
  };

  const onDiscard = () => {
    enrollment.discard();
    resetForm();
    setNotice(null);
  };

  const onCapture = () => {
    // The last save's notice belongs to that product; the next photo starts the next one.
    setNotice(null);
    enrollment.requestCapture();
  };

  const canCapture = !capturing && shots.length < MAX_SHOTS;
  // Saving or discarding while a capture is still being written would strand that shot.
  const idle = !capturing;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t('enroll.title')}</Text>
      {guidedDone !== null && (
        <Text style={styles.progress}>{t('enroll.guided.progress', { n: guidedDone + 1, target: FIRST_RUN_TARGET })}</Text>
      )}

      <Text style={styles.coach}>{t('enroll.coach')}</Text>
      {angle !== null && <Text style={styles.angle}>{t(ANGLE_KEYS[angle], { n: shots.length + 1 })}</Text>}
      <Text style={styles.label}>{t('enroll.shotsProgress', { taken: shots.length, max: MAX_SHOTS, min: MIN_SHOTS })}</Text>
      {shots.length > 0 && (
        <View style={styles.thumbs}>
          {shots.map((shot, i) => (
            <Pressable
              key={shot.id}
              onPress={() => enrollment.removeShot(shot.id)}
              disabled={!idle}
              accessibilityLabel={t('enroll.removeShot', { number: i + 1 })}
            >
              <Image
                source={{ uri: `file://${resolvePhotoPath(shot.photoPath)}` }}
                style={[styles.thumb, shot.warnings.length > 0 && styles.thumbWarned]}
              />
              <Text style={styles.thumbRemove}>✕</Text>
            </Pressable>
          ))}
        </View>
      )}
      {shots.flatMap((shot, i) =>
        shot.warnings.map((w) => (
          <Text key={`${shot.id}-${w}`} style={styles.warning}>
            {t(QUALITY_KEYS[w], { n: i + 1 })}
          </Text>
        )),
      )}
      {error !== null && (
        <Text style={styles.error}>
          {error.key === 'modelNotReady' ? t('enroll.errors.modelNotReady') : t('enroll.errors.captureFailed', { message: error.message })}
        </Text>
      )}
      <Button label={capturing ? t('enroll.capturing') : t('enroll.capture')} onPress={onCapture} disabled={!canCapture} />
      {duplicates.length > 0 && (
        <>
          <Text style={styles.warning}>{t('enroll.duplicate.live', { names: duplicateNames })}</Text>
          <Toggle
            label={t('enroll.duplicate.markBoth', { names: duplicateNames })}
            hint={t('enroll.duplicate.markBothHint')}
            value={markDuplicates}
            onChange={setMarkDuplicates}
          />
        </>
      )}

      <Field label={t('enroll.name')} value={form.name} onChangeText={field('name')} placeholder={t('enroll.namePlaceholder')} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Field label={t('enroll.pricePiece')} value={form.pricePiece} onChangeText={field('pricePiece')} placeholder="12.50" numeric />
        </View>
        {showOptional && (
          <View style={styles.flex}>
            <Field label={t('enroll.pricePack')} value={form.pricePack} onChangeText={field('pricePack')} placeholder="120.00" numeric />
          </View>
        )}
      </View>
      {showOptional && (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field label={t('enroll.unitLabel')} value={form.unitLabel} onChangeText={field('unitLabel')} placeholder={t('enroll.unitPlaceholder')} />
          </View>
          <View style={styles.flex}>
            <Field label={t('enroll.category')} value={form.category} onChangeText={field('category')} />
          </View>
        </View>
      )}
      {guided && (
        <Pressable onPress={() => setMoreOpen((open) => !open)} style={styles.more}>
          <Text style={styles.moreText}>{t(moreOpen ? 'enroll.more.hide' : 'enroll.more.show')}</Text>
        </Pressable>
      )}
      {/* Locked on while the look-alikes are being marked: a pair is repacked on both sides (repackedPlan). */}
      <Toggle
        label={t('enroll.repacked.label')}
        hint={t('enroll.repacked.hint')}
        value={plan.isAmbiguous}
        onChange={setRepacked}
        disabled={plan.markAmbiguous.length > 0}
      />
      {errors.map((e) => (
        <Text key={e} style={styles.error}>
          {t(FORM_ERROR_KEYS[e])}
        </Text>
      ))}

      <View style={styles.row}>
        <View style={styles.flex}>
          <Button label={t('enroll.save')} onPress={onSave} disabled={!idle} />
        </View>
        <View style={styles.flex}>
          <Button label={t('enroll.discard')} onPress={onDiscard} disabled={!idle} secondary />
        </View>
      </View>
      {notice !== null && <Text style={notice.tone === 'ok' ? styles.ok : styles.error}>{notice.text}</Text>}
      {notice?.tryScanning === true && <Button label={t('enroll.guided.tryScanning')} onPress={onTryScanning} />}
    </View>
  );
});

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  numeric = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7b8794"
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.toggle}>
      <View style={styles.flex}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ false: '#3a4655', true: '#2b6cb0' }}
        thumbColor={value ? '#ffd166' : '#e6eaef'}
      />
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, secondary && styles.buttonSecondary, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  title: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  progress: { color: '#ffd166', fontWeight: '800', fontSize: 16 },
  coach: { color: '#ffd166', fontWeight: '700', fontSize: 16 },
  angle: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  field: { gap: 4 },
  label: { color: '#e6eaef', fontSize: 12 },
  hint: { color: '#7b8794', fontSize: 12 },
  input: { backgroundColor: '#1b2430', color: '#ffffff', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8 },
  more: { alignSelf: 'flex-start', paddingVertical: 6 },
  moreText: { color: '#9ec5fe', fontWeight: '700', fontSize: 14 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  toggleLabel: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumb: { width: 56, height: 56, borderRadius: 4, backgroundColor: '#1b2430' },
  thumbWarned: { borderWidth: 2, borderColor: '#ffd166' },
  thumbRemove: { position: 'absolute', top: 0, right: 4, color: '#ffffff', fontWeight: '700' },
  warning: { color: '#ffd166', fontSize: 12 },
  error: { color: '#ff6b6b', fontSize: 12 },
  ok: { color: '#7bd88f', fontSize: 14 },
  button: { backgroundColor: '#2b6cb0', borderRadius: 6, paddingVertical: 12, alignItems: 'center' },
  buttonSecondary: { backgroundColor: '#1b2430' },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#ffffff', fontWeight: '700' },
});
