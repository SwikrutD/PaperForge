/**
 * Generates the PaperForge application icon (resources/icons/icon.ico and
 * icon.png) from original geometry — a sheet with a folded corner on a blue
 * tile — matching src/renderer/components/brand/LogoMark.tsx.
 *
 * No external image tooling and no network access: the PNG encoder and ICO
 * container are written here so `npm run icons` works on a clean machine.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ x: number, y: number, w: number, h: number, r: number }} Rect */
/** @typedef {{ r: number, g: number, b: number }} Rgb */

const OUTPUT_DIR = path.resolve(fileURLToPath(new URL('../resources/icons', import.meta.url)));
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const SUPERSAMPLE = 3;

// ---------------------------------------------------------------- geometry ---
// All coordinates are in the 32x32 design space used by the renderer logo.
/** @type {Rect} */
const TILE = { x: 1, y: 1, w: 30, h: 30, r: 7 };
/** @type {Rect} */
const PAGE = { x: 9.2, y: 7.6, w: 13.7, h: 17.6, r: 1.4 };
const FOLD = { x: 18, y: 7.6, size: 4.9 };
/** @type {Array<{ rect: Rect, color: Rgb }>} */
const STRIPES = [
  { rect: { x: 11.9, y: 16.4, w: 8.2, h: 1.5, r: 0.75 }, color: { r: 15, g: 108, b: 189 } },
  { rect: { x: 11.9, y: 19.4, w: 5.6, h: 1.5, r: 0.75 }, color: { r: 122, g: 169, b: 216 } },
];

/** @type {Rgb} */ const TILE_FROM = { r: 40, g: 134, b: 222 };
/** @type {Rgb} */ const TILE_TO = { r: 12, g: 74, b: 128 };
/** @type {Rgb} */ const PAGE_COLOR = { r: 255, g: 255, b: 255 };
/** @type {Rgb} */ const FOLD_COLOR = { r: 169, g: 201, b: 236 };

/**
 * @param {number} px
 * @param {number} py
 * @param {Rect} rect
 * @returns {boolean}
 */
function inRoundedRect(px, py, rect) {
  const { x, y, w, h, r } = rect;
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * The page is a rounded rectangle with its top-right corner cut diagonally.
 * @param {number} px
 * @param {number} py
 * @returns {boolean}
 */
function inPage(px, py) {
  if (!inRoundedRect(px, py, PAGE)) return false;
  return !(py - FOLD.y < px - FOLD.x);
}

/**
 * @param {number} px
 * @param {number} py
 * @returns {boolean}
 */
function inFold(px, py) {
  if (px < FOLD.x || py > FOLD.y + FOLD.size) return false;
  return py - FOLD.y >= px - FOLD.x && inPage(px, py);
}

/**
 * @param {Rgb} from
 * @param {Rgb} to
 * @param {number} t
 * @returns {Rgb}
 */
function mix(from, to, t) {
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  };
}

/**
 * Colour of one design-space sample, or null when fully transparent.
 * @param {number} px
 * @param {number} py
 * @returns {Rgb | null}
 */
function sample(px, py) {
  if (!inRoundedRect(px, py, TILE)) return null;
  const onPage = inPage(px, py);
  if (onPage) {
    for (const stripe of STRIPES) {
      if (inRoundedRect(px, py, stripe.rect)) return stripe.color;
    }
    if (inFold(px, py)) return FOLD_COLOR;
    return PAGE_COLOR;
  }
  return mix(TILE_FROM, TILE_TO, (px / 32 + py / 32) / 2);
}

/**
 * Renders the mark at `size` pixels into an RGBA buffer.
 * @param {number} size
 * @returns {Buffer}
 */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 32 / size / SUPERSAMPLE;
  const offset = step / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const color = sample(
            (x * 32) / size + sx * step + offset,
            (y * 32) / size + sy * step + offset,
          );
          if (color === null) continue;
          red += color.r;
          green += color.g;
          blue += color.b;
          covered += 1;
        }
      }

      if (covered === 0) continue;
      const index = (y * size + x) * 4;
      pixels[index] = Math.round(red / covered);
      pixels[index + 1] = Math.round(green / covered);
      pixels[index + 2] = Math.round(blue / covered);
      pixels[index + 3] = Math.round((covered / (SUPERSAMPLE * SUPERSAMPLE)) * 255);
    }
  }
  return pixels;
}

// --------------------------------------------------------------- encoding ---
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * @param {number} size
 * @param {Buffer} pixels
 * @returns {Buffer}
 */
function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0; // per-scanline filter: none
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param {Array<{ size: number, data: Buffer }>} images
 * @returns {Buffer}
 */
function encodeIco(images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // type: icon
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    // 256px is encoded as 0 in the ICO directory.
    directory[entry] = image.size >= 256 ? 0 : image.size;
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    directory[entry + 2] = 0; // palette size
    directory[entry + 3] = 0; // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  return Buffer.concat([directory, ...images.map((image) => image.data)]);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const images = ICO_SIZES.map((size) => ({ size, data: encodePng(size, render(size)) }));
const large = images.find((image) => image.size === 256);
if (large === undefined) throw new Error('The 256px icon was not rendered.');

writeFileSync(path.join(OUTPUT_DIR, 'icon.ico'), encodeIco(images));
writeFileSync(path.join(OUTPUT_DIR, 'icon.png'), large.data);
console.log(`Wrote icon.ico (${ICO_SIZES.join(', ')}px) and icon.png to ${OUTPUT_DIR}`);
