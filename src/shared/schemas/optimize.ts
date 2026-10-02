import { z } from 'zod';
import { documentEditStateSchema } from './edit';

/**
 * Making a document smaller.
 *
 * Every setting says what it does to the document, and the result is
 * measured rather than estimated: the size before and after are the sizes of
 * two real files.
 */

export const optimizePresetSchema = z.enum(['quality', 'balanced', 'small']);
export type OptimizePreset = z.infer<typeof optimizePresetSchema>;

export const optimizeSettingsSchema = z.strictObject({
  /** Pictures drawn at more than this resolution are made smaller. */
  downsample: z.boolean(),
  targetDpi: z.number().int().min(50).max(1200),
  /** JPEG pictures are compressed again at `jpegQuality`. */
  recompressJpeg: z.boolean(),
  jpegQuality: z.number().int().min(10).max(100),
  /**
   * Photographs stored without loss are stored as JPEG. Drawings,
   * screenshots and anything else with few colours are left lossless.
   */
  convertPhotos: z.boolean(),
  /** Colour pictures become grey. Text and drawings keep their colour. */
  grayscaleImages: z.boolean(),
  /** Uncompressed streams are compressed, which loses nothing. */
  compressStreams: z.boolean(),
  removeThumbnails: z.boolean(),
  /** The information dictionary and the XMP packet. */
  removeMetadata: z.boolean(),
  /** Objects nothing in the document refers to any more. */
  removeUnused: z.boolean(),
  /** qpdf packs objects into compressed object streams, where it is installed. */
  packObjects: z.boolean(),
  /** qpdf lays the file out for fast web view, where it is installed. */
  linearize: z.boolean(),
});
export type OptimizeSettings = z.infer<typeof optimizeSettingsSchema>;

/** What each preset sets. None of them removes metadata or changes colour. */
export const OPTIMIZE_PRESETS: Record<OptimizePreset, OptimizeSettings> = {
  quality: {
    downsample: true,
    targetDpi: 300,
    recompressJpeg: false,
    jpegQuality: 90,
    convertPhotos: false,
    grayscaleImages: false,
    compressStreams: true,
    removeThumbnails: true,
    removeMetadata: false,
    removeUnused: true,
    packObjects: true,
    linearize: false,
  },
  balanced: {
    downsample: true,
    targetDpi: 150,
    recompressJpeg: true,
    jpegQuality: 80,
    convertPhotos: true,
    grayscaleImages: false,
    compressStreams: true,
    removeThumbnails: true,
    removeMetadata: false,
    removeUnused: true,
    packObjects: true,
    linearize: false,
  },
  small: {
    downsample: true,
    targetDpi: 96,
    recompressJpeg: true,
    jpegQuality: 60,
    convertPhotos: true,
    grayscaleImages: false,
    compressStreams: true,
    removeThumbnails: true,
    removeMetadata: false,
    removeUnused: true,
    packObjects: true,
    linearize: false,
  },
};

/** What the document holds that an optimisation could act on. */
export const optimizeAnalysisSchema = z.strictObject({
  sizeBytes: z.number().int().min(0),
  pageCount: z.number().int().min(0),
  images: z.strictObject({
    total: z.number().int().min(0),
    /** Bytes of picture data, as stored. */
    bytes: z.number().int().min(0),
    jpeg: z.number().int().min(0),
    lossless: z.number().int().min(0),
    /** Pictures PaperForge can neither decode nor re-encode, such as CMYK or JBIG2. */
    untouchable: z.number().int().min(0),
    /** The highest resolution any picture is drawn at, when it could be measured. */
    highestDpi: z.number().min(0).nullable(),
  }),
  uncompressedStreams: z.number().int().min(0),
  thumbnails: z.number().int().min(0),
  hasMetadata: z.boolean(),
  linearized: z.boolean(),
  qpdfAvailable: z.boolean(),
});
export type OptimizeAnalysis = z.infer<typeof optimizeAnalysisSchema>;

/** What the engine changed, picture by picture and stream by stream. */
export const optimizeReportSchema = z.strictObject({
  imagesResampled: z.number().int().min(0),
  imagesRecompressed: z.number().int().min(0),
  imagesConverted: z.number().int().min(0),
  imagesGreyed: z.number().int().min(0),
  /** Pictures that would have come out larger, and were left as they were. */
  imagesKept: z.number().int().min(0),
  streamsCompressed: z.number().int().min(0),
  thumbnailsRemoved: z.number().int().min(0),
  metadataRemoved: z.boolean(),
  objectsRemoved: z.number().int().min(0),
});
export type OptimizeReport = z.infer<typeof optimizeReportSchema>;

export const optimizeOutcomeSchema = z.strictObject({
  /** False when nothing came out smaller, so the document was left alone. */
  applied: z.boolean(),
  beforeBytes: z.number().int().min(0),
  afterBytes: z.number().int().min(0),
  report: optimizeReportSchema,
  /** What qpdf did: packed the file, was not installed, or failed and was not used. */
  qpdf: z.enum(['used', 'unavailable', 'failed', 'notAsked']),
  linearized: z.boolean(),
  edit: documentEditStateSchema.nullable(),
});
export type OptimizeOutcome = z.infer<typeof optimizeOutcomeSchema>;
