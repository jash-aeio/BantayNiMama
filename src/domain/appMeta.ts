// app_meta, parsed — TR-23, TR-35, TR-38. Pure.
//
// Every value arrives from SQLite as TEXT. Plain Number() is not safe on it: Number('') is 0 and
// Number(' 0.46 ') is 0.46, so a blank τ row would silently become "accept everything". Each
// value is matched against a strict pattern before it becomes a number.

import { assertThresholds, type Thresholds } from './match.ts';

export const META_KEYS = {
  schemaVersion: 'schema_version',
  modelId: 'model_id',
  embeddingDim: 'embedding_dim',
  tau: 'tau',
  delta: 'delta',
  confirmBelow: 'confirm_below',
} as const;

export interface AppMeta {
  readonly schemaVersion: number;
  /** Which model every stored vector must come from (TR-23). */
  readonly modelId: string;
  readonly embeddingDim: number;
  /** τ and δ, read from data — never constants (TR-35, ADR-008). */
  readonly thresholds: Thresholds;
  /** TR-38: null until Phase 3 calibrates it from store data (ADR-013). */
  readonly confirmBelow: number | null;
}

export function parseAppMeta(values: Readonly<Record<string, string | undefined>>): AppMeta {
  const embeddingDim = wholeNumber(values, META_KEYS.embeddingDim);
  if (embeddingDim < 1) throw new RangeError(`app_meta "${META_KEYS.embeddingDim}" must be at least 1`);

  const thresholds = { tau: decimal(values, META_KEYS.tau), delta: decimal(values, META_KEYS.delta) };
  assertThresholds(thresholds);

  return {
    schemaVersion: wholeNumber(values, META_KEYS.schemaVersion),
    modelId: required(values, META_KEYS.modelId),
    embeddingDim,
    thresholds,
    confirmBelow: values[META_KEYS.confirmBelow] === undefined ? null : wholeNumber(values, META_KEYS.confirmBelow),
  };
}

function required(values: Readonly<Record<string, string | undefined>>, key: string): string {
  const value = values[key];
  if (value === undefined || value === '') throw new Error(`app_meta is missing "${key}"`);
  return value;
}

function wholeNumber(values: Readonly<Record<string, string | undefined>>, key: string): number {
  const value = required(values, key);
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n)) {
    throw new Error(`app_meta "${key}" must be a whole number, got "${value}"`);
  }
  return n;
}

function decimal(values: Readonly<Record<string, string | undefined>>, key: string): number {
  const value = required(values, key);
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`app_meta "${key}" must be a decimal number, got "${value}"`);
  return Number(value);
}
