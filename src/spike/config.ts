// Phase 0 spike configuration. Throwaway by design (see CLAUDE.md) — these are
// constants here ONLY because Phase 0 has no database yet. In production τ and δ
// live in `app_meta` and are never hard-coded (TR-35, ADR-008).

/** Model input side, from the model's own description: 224 x 224 RGB. */
export const INPUT_SIZE = 224;

/**
 * The model's tensor description states each element is a value between
 * min [0.0] and max [1.0] per channel — so bytes are scaled by 1/255,
 * NOT mapped to [-1, 1]. Getting this wrong silently degrades every score.
 */
export const INPUT_SCALE = 1 / 255;

/** Fraction of the frame's shorter edge used as the center reticle (ADR-006). */
export const RETICLE_FRACTION = 0.55;

/** TR-26: throttle to 4 fps. This is the main battery/thermal lever (NFR-06). */
export const TARGET_FPS = 4;

/**
 * TR-27: frames below this Laplacian variance are too blurry to embed.
 * The value is a placeholder — Phase 0 measures the real distribution and
 * `scripts/analyze.mjs` reports it. Do not treat this number as calibrated.
 */
export const SHARPNESS_FLOOR = 0;

/** Stamped onto every vector (TR-23) so a model swap can be detected. */
export const MODEL_ID = 'mobilenet_v3_large_embedder_v1';
