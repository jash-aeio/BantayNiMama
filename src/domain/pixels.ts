// Pixel bytes → model input — TR-21. Pure, and callable from the camera worklet.
//
// The live-frame embedder and the saved-JPEG embedder must turn pixels into model input in
// exactly the same way. If they differ — a swapped channel, a different scale — every score
// shifts between enrollment and scanning, and nothing ever throws. So both call this.

export interface ChannelLayout {
  /** Byte offsets of the R, G and B channels within one pixel. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Bytes per pixel. */
  readonly stride: number;
}

/** TR-21: the model's own tensor description asks for each channel in [0, 1], i.e. byte ÷ 255. */
const SCALE = 1 / 255;

/**
 * Where R, G and B sit for a raw pixel format name, or null for one we do not know.
 *
 * Android bitmaps come back RGBA and iOS typically BGRA, which is why the layout is read from the
 * image at runtime instead of assumed per platform. Takes a plain string so this module never
 * imports the native image library.
 */
export function channelLayout(pixelFormat: string): ChannelLayout | null {
  'worklet';
  switch (pixelFormat) {
    case 'RGBA':
    case 'RGBX':
      return { r: 0, g: 1, b: 2, stride: 4 };
    case 'BGRA':
    case 'BGRX':
      return { r: 2, g: 1, b: 0, stride: 4 };
    case 'ARGB':
    case 'XRGB':
      return { r: 1, g: 2, b: 3, stride: 4 };
    case 'ABGR':
    case 'XBGR':
      return { r: 3, g: 2, b: 1, stride: 4 };
    case 'RGB':
      return { r: 0, g: 1, b: 2, stride: 3 };
    case 'BGR':
      return { r: 2, g: 1, b: 0, stride: 3 };
    default:
      return null;
  }
}

/**
 * Packed pixels → Float32 RGB in [0, 1], pixel by pixel, alpha dropped.
 *
 * Throws unless the buffer holds exactly width × height pixels. A buffer with row padding would
 * otherwise be read with every row shifted — a quietly wrong input, never an error.
 */
export function toModelInput(
  bytes: Uint8Array,
  width: number,
  height: number,
  layout: ChannelLayout,
): Float32Array<ArrayBuffer> {
  'worklet';
  const pixels = width * height;
  if (bytes.length !== pixels * layout.stride) {
    throw new RangeError(
      `Pixel buffer has ${bytes.length} bytes; ${width}×${height} at ${layout.stride} bytes/pixel needs ${pixels * layout.stride}`,
    );
  }
  const out = new Float32Array(pixels * 3);
  for (let px = 0; px < pixels; px++) {
    const src = px * layout.stride;
    const dst = px * 3;
    out[dst] = bytes[src + layout.r]! * SCALE;
    out[dst + 1] = bytes[src + layout.g]! * SCALE;
    out[dst + 2] = bytes[src + layout.b]! * SCALE;
  }
  return out;
}

/**
 * The centre square the model sees (ADR-006): `fraction` of the shorter edge, centred, in whole
 * pixels. Scanning and enrollment both crop through this, so they can never disagree about where
 * the reticle is.
 */
export function reticleRect(
  width: number,
  height: number,
  fraction: number,
): { x0: number; y0: number; x1: number; y1: number } {
  'worklet';
  if (!(fraction > 0 && fraction <= 1)) throw new RangeError(`Reticle fraction must be in (0, 1], got ${fraction}`);
  const side = Math.floor(Math.min(width, height) * fraction);
  const x0 = Math.floor((width - side) / 2);
  const y0 = Math.floor((height - side) / 2);
  return { x0, y0, x1: x0 + side, y1: y0 + side };
}
