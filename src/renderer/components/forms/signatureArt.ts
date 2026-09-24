/**
 * Turning a mark into a picture.
 *
 * Whether the reader draws it, types it or brings a photograph of it, what
 * goes on the page is one PNG with a transparent background. Typed marks are
 * drawn with a font this computer already has and rasterised here, so no font
 * program is embedded in the document or redistributed.
 */

export interface SignatureArt {
  dataUrl: string;
  width: number;
  height: number;
}

/** The handwriting-like faces Windows ships, with plain fallbacks. */
export const SIGNATURE_STYLES = [
  { id: 'script', label: 'Script', font: "'Segoe Script', 'Brush Script MT', cursive" },
  { id: 'formal', label: 'Formal', font: "'Gabriola', 'Palatino Linotype', Georgia, serif" },
  { id: 'plain', label: 'Plain', font: "'Segoe UI', Arial, sans-serif" },
] as const;

export type SignatureStyleId = (typeof SIGNATURE_STYLES)[number]['id'];

/** The ink the reader drew, cropped to itself so it places tightly. */
export function drawnSignature(canvas: HTMLCanvasElement | null): SignatureArt | null {
  if (canvas === null) return null;
  const cropped = cropToInk(canvas);
  return cropped === null
    ? null
    : { dataUrl: cropped.toDataURL('image/png'), width: cropped.width, height: cropped.height };
}

/** A name drawn in one of the faces this computer has. */
export function typedSignature(text: string, styleId: SignatureStyleId): SignatureArt | null {
  if (text === '') return null;
  const style = SIGNATURE_STYLES.find((entry) => entry.id === styleId) ?? SIGNATURE_STYLES[0];

  const size = 96;
  const measuring = document.createElement('canvas');
  const measurer = measuring.getContext('2d');
  if (measurer === null) return null;
  measurer.font = `${String(size)}px ${style.font}`;
  const width = Math.ceil(measurer.measureText(text).width) + size;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.round(size * 1.8);
  const context = canvas.getContext('2d');
  if (context === null) return null;

  context.font = `${String(size)}px ${style.font}`;
  context.fillStyle = '#111111';
  context.textBaseline = 'middle';
  context.fillText(text, size / 2, canvas.height / 2);

  const cropped = cropToInk(canvas) ?? canvas;
  return { dataUrl: cropped.toDataURL('image/png'), width: cropped.width, height: cropped.height };
}

/**
 * A picture the reader brought in, with the paper taken away.
 *
 * A photograph of a signature is dark ink on a light page; anything light
 * enough to be paper is made transparent, and what is left keeps its shape.
 * A picture that already has transparency is left exactly as it is.
 */
export async function importedSignature(file: File): Promise<string> {
  const source = await loadImage(URL.createObjectURL(file));
  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('This computer could not read the picture.');
  context.drawImage(source, 0, 0);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  if (!hasTransparency(pixels.data)) {
    clearPaper(pixels.data);
    context.putImageData(pixels, 0, 0);
  }

  const cropped = cropToInk(canvas) ?? canvas;
  return cropped.toDataURL('image/png');
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This computer could not read the picture.'));
    };
    image.src = url;
  });
}

function hasTransparency(data: Uint8ClampedArray): boolean {
  for (let index = 3; index < data.length; index += 4) {
    if ((data[index] ?? 255) < 250) return true;
  }
  return false;
}

/**
 * Makes the paper transparent and the ink solid.
 *
 * Brightness decides: a pixel brighter than the threshold is paper, one
 * darker is ink, and the ones between fade so the edges stay smooth.
 */
function clearPaper(data: Uint8ClampedArray): void {
  const paper = 235;
  const ink = 120;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    const brightness = 0.299 * red + 0.587 * green + 0.114 * blue;

    if (brightness >= paper) {
      data[index + 3] = 0;
    } else if (brightness > ink) {
      data[index + 3] = Math.round(255 * ((paper - brightness) / (paper - ink)));
    }
  }
}

/** The part of a canvas that actually has something on it. */
function cropToInk(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width;
  let right = -1;
  let top = canvas.height;
  let bottom = -1;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if ((data[(y * canvas.width + x) * 4 + 3] ?? 0) < 8) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0 || bottom < 0) return null;

  // A little air around the mark, so it does not sit hard against its edge.
  const margin = Math.round(Math.max(canvas.width, canvas.height) * 0.02);
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(canvas.width - 1, right + margin);
  bottom = Math.min(canvas.height - 1, bottom + margin);

  const cropped = document.createElement('canvas');
  cropped.width = right - left + 1;
  cropped.height = bottom - top + 1;
  const target = cropped.getContext('2d');
  if (target === null) return null;
  target.drawImage(
    canvas,
    left,
    top,
    cropped.width,
    cropped.height,
    0,
    0,
    cropped.width,
    cropped.height,
  );
  return cropped;
}
