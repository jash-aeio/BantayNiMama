import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Catalog } from '../../db/catalog';
import { getProduct, updatePrice } from '../../db/products';
import type { InteractionKind } from '../../domain/interactionLog.ts';
import { planPriceEdit, priceFormOf, type PriceError, type PriceForm } from '../../domain/priceEdit.ts';

// The price editor opened from the scan card (SR-06, SR-08; P2-4). It is bound to the product id
// captured when the price was tapped, and reads nothing from the scanner after that. Voting is paused
// while it is open, so moving the phone to another product cannot move the edit (gate A2).

const PRICE_ERROR_KEYS = {
  piecePriceRequired: 'enroll.errors.piecePriceRequired',
  piecePriceInvalid: 'enroll.errors.piecePriceInvalid',
  packPriceInvalid: 'enroll.errors.packPriceInvalid',
} as const satisfies Record<PriceError, string>;

interface Props {
  readonly catalog: Catalog;
  /** Fixed for the life of this panel: ScanScreen keys it on the id. */
  readonly productId: string;
  readonly onClose: () => void;
  /** After a price change is committed. */
  readonly onSaved: () => void;
  /** SR-08: soft delete, with the undo bar (SR-32). */
  readonly onDelete: (productId: string) => void;
  readonly log: (kind: InteractionKind, productIds: readonly string[]) => void;
}

export const PriceEditPanel = memo(function PriceEditPanel({ catalog, productId, onClose, onSaved, onDelete, log }: Props) {
  const { t } = useTranslation();
  // Read once, at open. The prices compared on save are the ones the editor started from.
  const [product] = useState(() => getProduct(catalog.db, productId));
  const [form, setForm] = useState<PriceForm>(() => (product === null ? { pricePiece: '', pricePack: '' } : priceFormOf(product)));
  const [errors, setErrors] = useState<readonly PriceError[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  if (product === null) {
    return (
      <View style={styles.root}>
        <Text style={styles.error}>{t('scan.edit.gone')}</Text>
        <Button label={t('scan.edit.cancel')} onPress={onClose} secondary />
      </View>
    );
  }

  const save = () => {
    const plan = planPriceEdit(product, form);
    if (plan.kind === 'invalid') {
      setErrors(plan.errors);
      return;
    }
    setErrors([]);
    if (plan.kind === 'unchanged') {
      log('priceUnchanged', [product.id]);
      onClose();
      return;
    }
    try {
      // One transaction: the UPDATE and the price_history row (TR-41, ADR-021). It throws if the
      // product is gone, rather than writing the price anywhere else.
      const changed = updatePrice(catalog.db, product.id, { pricePiece: plan.pricePiece, pricePack: plan.pricePack });
      log(changed ? 'priceSaved' : 'priceUnchanged', [product.id]);
      if (changed) onSaved();
      else onClose();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    }
  };

  const field = (key: keyof PriceForm) => (text: string) => setForm((previous) => ({ ...previous, [key]: text }));

  return (
    <View style={styles.root}>
      <Text style={styles.title} numberOfLines={2}>
        {t('scan.edit.title', { name: product.name })}
      </Text>
      <Text style={styles.hint}>{t('scan.edit.hint', { name: product.name })}</Text>
      <View style={styles.row}>
        <Field label={t('enroll.pricePiece')} value={form.pricePiece} onChangeText={field('pricePiece')} placeholder="12.50" />
        <Field label={t('enroll.pricePack')} value={form.pricePack} onChangeText={field('pricePack')} placeholder="120.00" />
      </View>
      {errors.map((e) => (
        <Text key={e} style={styles.error}>
          {t(PRICE_ERROR_KEYS[e])}
        </Text>
      ))}
      {failure !== null && <Text style={styles.error}>{t('scan.edit.saveFailed', { message: failure })}</Text>}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button label={t('scan.edit.save')} onPress={save} />
        </View>
        <View style={styles.flex}>
          <Button label={t('scan.edit.cancel')} onPress={onClose} secondary />
        </View>
      </View>
      <View style={styles.divider} />
      <Pressable onPress={() => onDelete(product.id)} style={[styles.button, styles.danger]}>
        <Text style={styles.buttonText}>{t('scan.edit.delete')}</Text>
      </Pressable>
    </View>
  );
});

function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (text: string) => void; placeholder: string }) {
  return (
    <View style={[styles.flex, styles.field]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7b8794"
        keyboardType="decimal-pad"
        autoCorrect={false}
        selectTextOnFocus
        style={styles.input}
      />
    </View>
  );
}

function Button({ label, onPress, secondary = false }: { label: string; onPress: () => void; secondary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, secondary && styles.secondary]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  hint: { color: '#9aa5b1', fontSize: 14 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  field: { gap: 4 },
  label: { color: '#e6eaef', fontSize: 12 },
  input: { backgroundColor: '#1b2430', color: '#ffd166', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 10, fontSize: 24, fontWeight: '700' },
  error: { color: '#ff6b6b', fontSize: 14 },
  divider: { height: 1, backgroundColor: '#1b2430', marginVertical: 4 },
  button: { backgroundColor: '#2b6cb0', borderRadius: 8, minHeight: 52, justifyContent: 'center', alignItems: 'center' },
  secondary: { backgroundColor: '#1b2430' },
  danger: { backgroundColor: '#742a2a' },
  buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 18 },
});
