import { nativeImage } from 'electron';
import type { ImageCodec, Raster } from '@pdf/optimize/pixels';

/**
 * JPEG through Chromium's own codecs, which Electron exposes as
 * `nativeImage`. Nothing is installed for this and nothing leaves the
 * process: a picture is decoded to samples and encoded again in memory.
 *
 * Chromium's bitmaps are four bytes a pixel, blue first; PaperForge's are
 * packed grey or RGB, so each crossing converts.
 */
export const nativeImageCodec: ImageCodec = {
  decodeJpeg(bytes: Uint8Array): Raster | null {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();
    if (bitmap.length < width * height * 4) return null;

    const samples = new Uint8Array(width * height * 3);
    for (let index = 0; index < width * height; index += 1) {
      samples[index * 3] = bitmap[index * 4 + 2] ?? 0;
      samples[index * 3 + 1] = bitmap[index * 4 + 1] ?? 0;
      samples[index * 3 + 2] = bitmap[index * 4] ?? 0;
    }
    return { width, height, channels: 3, samples };
  },

  encodeJpeg(raster: Raster, quality: number): Uint8Array {
    const { width, height, channels, samples } = raster;
    const bitmap = Buffer.alloc(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      const red = samples[index * channels] ?? 0;
      const green = channels === 3 ? (samples[index * 3 + 1] ?? 0) : red;
      const blue = channels === 3 ? (samples[index * 3 + 2] ?? 0) : red;
      bitmap[index * 4] = blue;
      bitmap[index * 4 + 1] = green;
      bitmap[index * 4 + 2] = red;
      bitmap[index * 4 + 3] = 255;
    }
    const image = nativeImage.createFromBitmap(bitmap, { width, height });
    return new Uint8Array(image.toJPEG(Math.max(1, Math.min(100, Math.round(quality)))));
  },
};
