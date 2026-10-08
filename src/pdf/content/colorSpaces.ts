import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import { deviceColorSpace, type Color, type ColorSpace, type ColorSpaceLookup } from './state';

/**
 * The colour spaces a page names in its resources, as colours a screen can
 * show.
 *
 * `/CS0 cs 1 scn` means nothing without the page's `/ColorSpace` dictionary:
 * in a separation it is full ink, in a gray ICC space it is white, in an
 * indexed space it is the second palette entry. Guessing from how many
 * numbers there are reads full black ink as white, which is how text came to
 * open in the editor invisible on a white page.
 *
 * Every space here comes out in a device space. Where a space cannot be
 * evaluated exactly — a spot colour whose tint transform is a PostScript
 * function — its colour is approximated by how much ink it lays down, which
 * keeps dark text dark.
 */

const MAX_DEPTH = 8;

const PROCESS_INKS: Record<string, number> = { Cyan: 0, Magenta: 1, Yellow: 2, Black: 3 };

interface ResolvedSpace extends ColorSpace {
  components: number;
  /** What a palette byte (0–255) means in this space, for indexed spaces. */
  fromByte: (byte: number, component: number) => number;
}

const unitByte = (byte: number): number => byte / 255;

function device(name: string, components: number): ResolvedSpace | undefined {
  const space = deviceColorSpace(name);
  return space === undefined ? undefined : { ...space, components, fromByte: unitByte };
}

const NAMED: Record<string, () => ResolvedSpace | undefined> = {
  DeviceGray: () => device('DeviceGray', 1),
  G: () => device('DeviceGray', 1),
  CalGray: () => device('DeviceGray', 1),
  DeviceRGB: () => device('DeviceRGB', 3),
  RGB: () => device('DeviceRGB', 3),
  CalRGB: () => device('DeviceRGB', 3),
  DeviceCMYK: () => device('DeviceCMYK', 4),
  CMYK: () => device('DeviceCMYK', 4),
  Pattern: () => device('Pattern', 0),
};

/** Reads colour spaces from a resource dictionary as the walk asks for them. */
export function readColorSpaces(
  document: PDFDocument,
  resources: PDFDict | undefined,
): ColorSpaceLookup {
  const dictionary =
    resources === undefined
      ? undefined
      : document.context.lookupMaybe(resources.get(PDFName.of('ColorSpace')), PDFDict);
  const cache = new Map<string, ColorSpace | undefined>();

  return (name) => {
    if (cache.has(name)) return cache.get(name);
    let space: ColorSpace | undefined;
    try {
      const entry = dictionary?.get(PDFName.of(name));
      space = entry === undefined ? undefined : resolve(document, entry, 0);
    } catch {
      // A space PaperForge cannot read is guessed at, as it was before.
      space = undefined;
    }
    cache.set(name, space);
    return space;
  };
}

function resolve(
  document: PDFDocument,
  value: PDFObject,
  depth: number,
): ResolvedSpace | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const object = document.context.lookup(value);

  if (object instanceof PDFName) return NAMED[object.decodeText()]?.();
  if (!(object instanceof PDFArray) || object.size() === 0) return undefined;

  const family = document.context.lookupMaybe(object.get(0), PDFName)?.decodeText();
  switch (family) {
    case 'CalGray':
    case 'CalRGB':
    case 'Pattern':
      return NAMED[family]?.();
    case 'ICCBased':
      return iccBased(document, object, depth);
    case 'Lab':
      return lab(document, object);
    case 'Indexed':
    case 'I':
      return indexed(document, object, depth);
    case 'Separation':
      return separation(document, object, depth);
    case 'DeviceN':
      return deviceN(document, object);
    default:
      return family === undefined ? undefined : NAMED[family]?.();
  }
}

function iccBased(
  document: PDFDocument,
  array: PDFArray,
  depth: number,
): ResolvedSpace | undefined {
  const stream = document.context.lookupMaybe(array.get(1), PDFStream);
  if (stream === undefined) return undefined;
  const alternate = stream.dict.get(PDFName.of('Alternate'));
  if (alternate !== undefined) {
    const resolved = resolve(document, alternate, depth + 1);
    if (resolved !== undefined) return resolved;
  }
  const count = numberIn(document, stream.dict.get(PDFName.of('N')));
  if (count === 1) return NAMED['DeviceGray']?.();
  if (count === 3) return NAMED['DeviceRGB']?.();
  if (count === 4) return NAMED['DeviceCMYK']?.();
  return undefined;
}

/** CIE L*a*b*, converted to sRGB against the space's white point. */
function lab(document: PDFDocument, array: PDFArray): ResolvedSpace {
  const dict = document.context.lookupMaybe(array.get(1), PDFDict);
  const white = numbersIn(document, dict?.get(PDFName.of('WhitePoint')));
  const range = numbersIn(document, dict?.get(PDFName.of('Range')));
  const [xw = 0.9505, yw = 1, zw = 1.089] = white;
  const [aMin = -100, aMax = 100, bMin = -100, bMax = 100] = range;

  const colorOf = (components: number[]): Color => {
    const [l = 0, a = 0, b = 0] = components;
    return { space: 'rgb', components: labToRgb(l, clamp(a, aMin, aMax), clamp(b, bMin, bMax)) };
  };
  const labToRgb = (l: number, a: number, b: number): number[] => {
    const fy = (l + 16) / 116;
    const g = (t: number): number => (t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29));
    const x = xw * g(fy + a / 500);
    const y = yw * g(fy);
    const z = zw * g(fy - b / 200);
    const linear = [
      3.2406 * x - 1.5372 * y - 0.4986 * z,
      -0.9689 * x + 1.8758 * y + 0.0415 * z,
      0.0557 * x - 0.204 * y + 1.057 * z,
    ];
    return linear.map((c) =>
      clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055, 0, 1),
    );
  };

  const fromByte = (byte: number, component: number): number => {
    const unit = byte / 255;
    if (component === 0) return unit * 100;
    return component === 1 ? aMin + unit * (aMax - aMin) : bMin + unit * (bMax - bMin);
  };

  return { initial: colorOf([0, 0, 0]), colorOf, components: 3, fromByte };
}

function indexed(document: PDFDocument, array: PDFArray, depth: number): ResolvedSpace | undefined {
  const base = array.get(1);
  const resolvedBase = base === undefined ? undefined : resolve(document, base, depth + 1);
  const table = bytesOf(document, array.get(3));
  if (resolvedBase === undefined || table === null) return undefined;

  const high = Math.max(0, Math.floor(numberIn(document, array.get(2)) ?? 0));
  const width = resolvedBase.components;
  const colorOf = (components: number[]): Color => {
    const index = clamp(Math.round(components[0] ?? 0), 0, high);
    const entry: number[] = [];
    for (let component = 0; component < width; component += 1) {
      entry.push(resolvedBase.fromByte(table[index * width + component] ?? 0, component));
    }
    return resolvedBase.colorOf(entry);
  };

  return { initial: colorOf([0]), colorOf, components: 1, fromByte: (byte) => byte };
}

/**
 * A single ink. `All` is every ink at once, so a tint of it is that much
 * black; a process ink is that plate of CMYK; anything else goes through its
 * tint transform when that is an exponential function, and is otherwise
 * shown as a gray as dark as the ink is heavy.
 */
function separation(
  document: PDFDocument,
  array: PDFArray,
  depth: number,
): ResolvedSpace | undefined {
  const ink = document.context.lookupMaybe(array.get(1), PDFName)?.decodeText() ?? '';
  const alternate = array.get(2);
  const resolvedAlternate =
    alternate === undefined ? undefined : resolve(document, alternate, depth + 1);
  const transform = exponential(document, array.get(3));

  const colorOf = (components: number[]): Color => {
    const tint = clamp(components[0] ?? 1, 0, 1);
    const plate = PROCESS_INKS[ink];
    if (plate !== undefined) {
      const cmyk = [0, 0, 0, 0];
      cmyk[plate] = tint;
      return { space: 'cmyk', components: cmyk };
    }
    if (ink !== 'All' && transform !== null && resolvedAlternate !== undefined) {
      return resolvedAlternate.colorOf(transform(tint));
    }
    return inkGray(tint);
  };

  return { initial: colorOf([1]), colorOf, components: 1, fromByte: unitByte };
}

/** Several inks; process inks become CMYK, and other inks darken the result. */
function deviceN(document: PDFDocument, array: PDFArray): ResolvedSpace | undefined {
  const names = document.context.lookupMaybe(array.get(1), PDFArray);
  if (names === undefined) return undefined;
  const inks: string[] = [];
  for (let index = 0; index < names.size(); index += 1) {
    inks.push(document.context.lookupMaybe(names.get(index), PDFName)?.decodeText() ?? '');
  }

  const colorOf = (components: number[]): Color => {
    const cmyk = [0, 0, 0, 0];
    let spot = 0;
    inks.forEach((ink, index) => {
      const tint = clamp(components[index] ?? 1, 0, 1);
      const plate = PROCESS_INKS[ink];
      if (plate !== undefined) cmyk[plate] = Math.max(cmyk[plate] ?? 0, tint);
      else if (ink !== 'None') spot = Math.max(spot, tint);
    });
    cmyk[3] = Math.max(cmyk[3] ?? 0, spot);
    return { space: 'cmyk', components: cmyk };
  };

  return {
    initial: colorOf(inks.map(() => 1)),
    colorOf,
    components: inks.length,
    fromByte: unitByte,
  };
}

/** A tint of an ink PaperForge cannot evaluate: as dark as it is heavy. */
function inkGray(tint: number): Color {
  return { space: 'gray', components: [1 - tint] };
}

/** A type 2 (exponential) function of one input, or null for any other. */
function exponential(
  document: PDFDocument,
  value: PDFObject | undefined,
): ((input: number) => number[]) | null {
  if (value === undefined) return null;
  const object = document.context.lookup(value);
  const dict = object instanceof PDFStream ? object.dict : object;
  if (!(dict instanceof PDFDict)) return null;
  if (numberIn(document, dict.get(PDFName.of('FunctionType'))) !== 2) return null;

  const c0 = numbersIn(document, dict.get(PDFName.of('C0')));
  const c1 = numbersIn(document, dict.get(PDFName.of('C1')));
  const n = numberIn(document, dict.get(PDFName.of('N'))) ?? 1;
  const start = c0.length > 0 ? c0 : [0];
  const end = c1.length > 0 ? c1 : [1];
  return (input) => start.map((from, index) => from + input ** n * ((end[index] ?? 1) - from));
}

function bytesOf(document: PDFDocument, value: PDFObject | undefined): Uint8Array | null {
  if (value === undefined) return null;
  const object = document.context.lookup(value);
  if (object instanceof PDFString || object instanceof PDFHexString) return object.asBytes();
  if (object instanceof PDFRawStream) return decodePDFRawStream(object).decode();
  if (object instanceof PDFStream) return object.getContents();
  return null;
}

function numberIn(document: PDFDocument, value: PDFObject | undefined): number | undefined {
  if (value === undefined) return undefined;
  return document.context.lookupMaybe(value, PDFNumber)?.asNumber();
}

function numbersIn(document: PDFDocument, value: PDFObject | undefined): number[] {
  if (value === undefined) return [];
  const array = document.context.lookupMaybe(value, PDFArray);
  if (array === undefined) return [];
  const numbers: number[] = [];
  for (let index = 0; index < array.size(); index += 1) {
    numbers.push(numberIn(document, array.get(index)) ?? 0);
  }
  return numbers;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
