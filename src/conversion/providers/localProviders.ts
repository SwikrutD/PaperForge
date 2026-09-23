import { AppError } from '@shared/errors/appError';
import type { PageSetup } from '@shared/schemas/create';
import { measureImage } from '@shared/utils/imageHeader';
import { createFromImages, createFromText } from '@pdf/create/documents';
import type { ConversionProvider, SourceInput } from '../models/provider';

/**
 * The providers that need nothing but PaperForge itself: a PDF is already a
 * PDF, an image becomes a page, and a text file becomes pages of text.
 *
 * Anything needing a local component — a web page needs Chromium's printing,
 * an Office document needs a local converter — lives with the process that has
 * it, and is registered alongside these.
 */

const NO_METADATA = { title: '', author: '' } as const;

export const pdfProvider: ConversionProvider = {
  id: 'pdf',
  label: 'PDF documents',
  extensions: ['pdf'],
  availability: () => Promise.resolve(null),
  toPdf: (input) => Promise.resolve(input.bytes),
};

export const imageProvider: ConversionProvider = {
  id: 'image',
  label: 'Images',
  extensions: ['png', 'jpg', 'jpeg'],
  availability: () => Promise.resolve(null),
  toPdf: async (input: SourceInput, setup: PageSetup) => {
    const facts = measureImage(input.bytes);
    if (facts === null) {
      throw new AppError('internal/unexpected', {
        message: `${input.fileName} is not a PNG or JPEG image.`,
        details: 'The file does not begin like either format.',
      });
    }

    return createFromImages(
      [{ bytes: input.bytes, format: facts.format, fileName: input.fileName }],
      setup,
      NO_METADATA,
    );
  },
};

export const textProvider: ConversionProvider = {
  id: 'text',
  label: 'Text files',
  extensions: ['txt', 'text', 'log', 'md', 'csv'],
  availability: () => Promise.resolve(null),
  toPdf: (input: SourceInput, setup: PageSetup) =>
    createFromText(decodeText(input.bytes), setup, NO_METADATA),
};

/**
 * Reads a text file the way a text editor would: UTF-8 unless the file says
 * otherwise with a byte order mark.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return new TextDecoder('utf-8').decode(bytes.subarray(start));
}
