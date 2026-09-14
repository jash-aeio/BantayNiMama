// Summaries for on-device measurements. Pure.

export interface Summary {
  readonly n: number;
  readonly median: number;
  readonly p90: number;
  readonly max: number;
}

/**
 * Median, p90 and max of the finite samples, or null when there are none.
 *
 * Nearest-rank percentiles, no interpolation: every number reported is a latency that actually
 * happened on the device, which is what CLAUDE.md asks the docs to record.
 */
export function summarize(samples: readonly number[]): Summary | null {
  const sorted = samples.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
  return { n: sorted.length, median: rank(0.5), p90: rank(0.9), max: sorted[sorted.length - 1]! };
}
