import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useAppServices } from '../../app/services';
import { getProduct, shotCounts, softDeleteProduct, updateProduct } from '../../db/products';
import { MAX_EXTRA_SHOTS } from '../../domain/correction.ts';
import type { FormError } from '../../domain/enrollment.ts';
import { planProductEdit, productFormOf, type ProductForm } from '../../domain/productEdit.ts';
import { Button, Field, Toggle } from '../../ui/FormControls';

// Edit any field of a product from the Directory (SR-31, P2-7), plus *Teach again* (SR-33) and delete
// (SR-32). Bound to the product id it opened with, and reading nothing else afterwards.

const FORM_ERROR_KEYS = {
  nameRequired: 'enroll.errors.nameRequired',
  piecePriceRequired: 'enroll.errors.piecePriceRequired',
  piecePriceInvalid: 'enroll.errors.piecePriceInvalid',
  packPriceInvalid: 'enroll.errors.packPriceInvalid',
} as const satisfies Record<FormError, string>;

interface Props {
  readonly productId: string;
  readonly onClose: () => void;
  /** Hands the product to the Scan tab, which owns the camera. */
  readonly onTeach: (productId: string) => void;
}

export function ProductEditPanel({ productId, onClose, onTeach }: Props) {
  const { t } = useTranslation();
  const { catalog, bumpCatalogVersion, rebuildIndex, logInteraction: log } = useAppServices();
  // Read once, at open. The values compared on save are the ones the editor started from.
  const [product] = useState(() => getProduct(catalog.db, productId));
  const [counts] = useState(() => shotCounts(catalog.db, productId));
  const [form, setForm] = useState<ProductForm | null>(() => (product === null ? null : productFormOf(product)));
  const [errors, setErrors] = useState<readonly FormError[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  if (product === null || form === null) {
    return (
      <View style={styles.root}>
        <Text style={styles.error}>{t('products.edit.gone')}</Text>
        <Button label={t('products.edit.cancel')} onPress={onClose} tone="secondary" />
      </View>
    );
  }

  const field = (key: Exclude<keyof ProductForm, 'isAmbiguous'>) => (text: string) =>
    setForm((previous) => (previous === null ? previous : { ...previous, [key]: text }));

  const save = () => {
    const plan = planProductEdit(product, form);
    if (plan.kind === 'invalid') {
      setErrors(plan.errors);
      return;
    }
    setErrors([]);
    if (plan.kind === 'unchanged') {
      log('productUnchanged', [product.id]);
      onClose();
      return;
    }
    try {
      // One transaction; a price change also writes price_history (ADR-021). Throws if the product
      // was deleted meanwhile, rather than writing anywhere else.
      updateProduct(catalog.db, product.id, plan.details, plan.prices);
    } catch (e) {
      setFailure(t('products.edit.saveFailed', { message: messageOf(e) }));
      return;
    }
    log('productSaved', [product.id]);
    // The repacked flag and the name are read by the scanner through catalogVersion; no index change.
    bumpCatalogVersion();
    onClose();
  };

  const remove = () => {
    Alert.alert(t('products.edit.deleteTitle', { name: product.name }), t('products.edit.deleteBody'), [
      { text: t('products.edit.cancel'), style: 'cancel' },
      {
        text: t('products.edit.deleteConfirm'),
        style: 'destructive',
        onPress: () => {
          if (!softDeleteProduct(catalog.db, product.id)) {
            onClose();
            return;
          }
          log('delete', [product.id]);
          try {
            rebuildIndex('delete');
          } catch (e) {
            bumpCatalogVersion();
            setFailure(t('products.edit.deleteFailed', { message: messageOf(e) }));
            return;
          }
          bumpCatalogVersion();
          onClose();
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title} numberOfLines={2}>
        {t('products.edit.title', { name: product.name })}
      </Text>
      <Field label={t('enroll.name')} value={form.name} onChangeText={field('name')} />
      <View style={styles.row}>
        <Field label={t('enroll.pricePiece')} value={form.pricePiece} onChangeText={field('pricePiece')} placeholder="12.50" numeric />
        <Field label={t('enroll.pricePack')} value={form.pricePack} onChangeText={field('pricePack')} placeholder="120.00" numeric />
      </View>
      <View style={styles.row}>
        <Field label={t('enroll.unitLabel')} value={form.unitLabel} onChangeText={field('unitLabel')} placeholder={t('enroll.unitPlaceholder')} />
        <Field label={t('enroll.category')} value={form.category} onChangeText={field('category')} />
      </View>
      <Toggle
        label={t('enroll.repacked.label')}
        hint={t('enroll.repacked.hint')}
        value={form.isAmbiguous}
        onChange={(isAmbiguous) => setForm((previous) => (previous === null ? previous : { ...previous, isAmbiguous }))}
      />
      {errors.map((e) => (
        <Text key={e} style={styles.error}>
          {t(FORM_ERROR_KEYS[e])}
        </Text>
      ))}
      {failure !== null && <Text style={styles.error}>{failure}</Text>}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button label={t('products.edit.save')} onPress={save} />
        </View>
        <View style={styles.flex}>
          <Button label={t('products.edit.cancel')} onPress={onClose} tone="secondary" />
        </View>
      </View>

      <View style={styles.divider} />
      <Text style={styles.label}>
        {t('products.edit.photos', { enroll: counts.enroll, extra: counts.correction + counts.teach, max: MAX_EXTRA_SHOTS })}
      </Text>
      <Button label={t('products.edit.teach')} onPress={() => onTeach(product.id)} tone="secondary" />
      <Button label={t('products.edit.delete')} onPress={remove} tone="danger" />
    </View>
  );
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  label: { color: '#9aa5b1', fontSize: 12 },
  error: { color: '#ff6b6b', fontSize: 14 },
  divider: { height: 1, backgroundColor: '#1b2430', marginVertical: 4 },
});
