/**
 * Pictures as samples: making them smaller, making them grey, and telling a
 * photograph from a drawing.
 *
 * Everything here works on 8-bit samples packed row by row, one or three
 * channels, which is what a decoded PDF picture and a decoded JPEG both are.
 */

export interface Raster {
  width: number;
  height: number;
  channels: 1 | 3;
  /** `width * height * channels` bytes, top row first. */
  samples: Uint8Array;
}

/**
 * JPEG in and out, which PaperForge does not implement itself. The main
 * process supplies one backed by Chromium's codecs; tests supply their own.
 */
export interface ImageCodec {
  /** Decodes a JPEG to samples, or null when it cannot (CMYK, say). */
  decodeJpeg(bytes: Uint8Array): Raster | null;
  /** Encodes samples as a baseline JPEG at a quality from 1 to 100. */
  encodeJpeg(raster: Raster, quality: number): Uint8Array;
}

/**
 * Shrinks a picture by averaging the samples each new one covers.
 *
 * Area averaging is what keeps fine detail from turning into noise when a
 * picture loses most of its pixels, which is exactly the case here. It only
 * ever makes a picture smaller.
 */
export function downsample(raster: Raster, width: number, height: number): Raster {
  const targetWidth = Math.max(1, Math.min(raster.width, Math.round(width)));
  const targetHeight = Math.max(1, Math.min(raster.height, Math.round(height)));
  if (targetWidth === raster.width && targetHeight === raster.height) return raster;

  const { channels, samples } = raster;
  const out = new Uint8Array(targetWidth * targetHeight * channels);
  const xRatio = raster.width / targetWidth;
  const yRatio = raster.height / targetHeight;
  const sums = new Float64Array(channels);

  for (let y = 0; y < targetHeight; y += 1) {
    const top = y * yRatio;
    const bottom = top + yRatio;
    for (let x = 0; x < targetWidth; x += 1) {
      const left = x * xRatio;
      const right = left + xRatio;
      sums.fill(0);
      let area = 0;

      for (let row = Math.floor(top); row < Math.ceil(bottom); row += 1) {
        const rowWeight = Math.min(bottom, row + 1) - Math.max(top, row);
        if (rowWeight <= 0) continue;
        for (let column = Math.floor(left); column < Math.ceil(right); column += 1) {
          const weight = rowWeight * (Math.min(right, column + 1) - Math.max(left, column));
          if (weight <= 0) continue;
          const at = (row * raster.width + column) * channels;
          for (let channel = 0; channel < channels; channel += 1) {
            sums[channel] = (sums[channel] ?? 0) + (samples[at + channel] ?? 0) * weight;
          }
          area += weight;
        }
      }

      const at = (y * targetWidth + x) * channels;
      for (let channel = 0; channel < channels; channel += 1) {
        out[at + channel] = Math.round((sums[channel] ?? 0) / (area || 1));
      }
    }
  }

  return { width: targetWidth, height: targetHeight, channels, samples: out };
}

/** The picture in grey, weighted the way the eye weighs the three primaries. */
export function toGrey(raster: Raster): Raster {
  if (raster.channels === 1) return raster;
  const count = raster.width * raster.height;
  const out = new Uint8Array(count);
  const { samples } = raster;
  for (let index = 0; index < count; index += 1) {
    const at = index * 3;
    out[index] = Math.round(
      0.299 * (samples[at] ?? 0) + 0.587 * (samples[at + 1] ?? 0) + 0.114 * (samples[at + 2] ?? 0),
    );
  }
  return { width: raster.width, height: raster.height, channels: 1, samples: out };
}

/** Three channels from one, for an encoder that only writes colour. */
export function toRgb(raster: Raster): Raster {
  if (raster.channels === 3) return raster;
  const count = raster.width * raster.height;
  const out = new Uint8Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const value = raster.samples[index] ?? 0;
    out[index * 3] = value;
    out[index * 3 + 1] = value;
    out[index * 3 + 2] = value;
  }
  return { width: raster.width, height: raster.height, channels: 3, samples: out };
}

/**
 * More distinct colours than this in a sample of the picture makes it a
 * photograph. A grey picture has at most 256, so its bar is lower.
 */
const PHOTO_COLOURS = { 1: 160, 3: 512 } as const;
const SAMPLE_POINTS = 8192;

/**
 * True when the picture looks like a photograph: many distinct colours.
 *
 * A screenshot, a chart or a scanned page of text has few, and JPEG would
 * smear their edges; a photograph has thousands, and JPEG is what it is for.
 */
export function looksPhotographic(raster: Raster): boolean {
  const count = raster.width * raster.height;
  if (count < 64 * 64) return false;
  const step = Math.max(1, Math.floor(count / SAMPLE_POINTS));
  const seen = new Set<number>();
  for (let index = 0; index < count; index += step) {
    const at = index * raster.channels;
    const key =
      raster.channels === 1
        ? (raster.samples[at] ?? 0)
        : ((raster.samples[at] ?? 0) << 16) |
          ((raster.samples[at + 1] ?? 0) << 8) |
          (raster.samples[at + 2] ?? 0);
    seen.add(key);
    if (seen.size > PHOTO_COLOURS[raster.channels]) return true;
  }
  return false;
}
