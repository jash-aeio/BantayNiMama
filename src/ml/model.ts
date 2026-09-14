// The embedding model and the crop it sees — shared by scanning and enrollment.
// If the two paths disagreed on any of these, every enrolled vector would be compared with
// frames processed differently, and scores would shift without anything throwing.

/**
 * Identity of the bundled model file. It must equal `app_meta.model_id`: vectors from any other
 * model are not comparable and must be re-embedded from their JPEGs (TR-23, TR-24).
 */
export const MODEL_ID = 'mobilenet_v3_large_embedder_v1';

/** Model input side, from the model file's own tensor description: 224 × 224 RGB (TR-21). */
export const INPUT_SIZE = 224;

/** Fraction of the frame's shorter edge embedded as the centre reticle (ADR-006). */
export const RETICLE_FRACTION = 0.55;

/** TR-26: processed frames per second — the main battery and thermal lever (NFR-06). */
export const TARGET_FPS = 4;
