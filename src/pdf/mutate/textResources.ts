import {
  PDFDict,
  PDFName,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import type { TextStyle } from '@shared/schemas/text';

/**
 * The fonts PaperForge draws replacement text with.
 *
 * They are the fourteen fonts every PDF reader already has, so nothing is
 * embedded and no font is redistributed — a file PaperForge writes text into
 * carries no font program that was not already there.
 *
 * A resource added here is named `PF…`, which is also how the editor knows a
 * run was drawn by PaperForge rather than by whatever made the document.
 */

/** Names a font resource PaperForge added, and nothing else. */
export const REPLACEMENT_PREFIX = 'PF';

const STANDARD: Record<string, Record<string, StandardFonts>> = {
  helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
  },
  times: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic,
  },
  courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique,
  },
};

function variantOf(style: TextStyle): string {
  if (style.bold && style.italic) return 'boldItalic';
  if (style.bold) return 'bold';
  if (style.italic) return 'italic';
  return 'regular';
}

/** The resource name for a style, which is also its identity on the page. */
export function resourceNameFor(style: TextStyle): string {
  const family = style.family.charAt(0).toUpperCase() + style.family.slice(1, 4);
  const variant = variantOf(style);
  const suffix =
    variant === 'regular' ? '' : variant === 'boldItalic' ? 'BI' : variant === 'bold' ? 'B' : 'I';
  return `${REPLACEMENT_PREFIX}${family}${suffix}`;
}

/**
 * A standard font for a style, embedded once per document.
 *
 * The same font on ten pages is one object in the file, and one set of
 * metrics for measuring text before it is drawn.
 */
export async function standardFont(document: PDFDocument, style: TextStyle): Promise<PDFFont> {
  let fonts = EMBEDDED.get(document);
  if (fonts === undefined) {
    fonts = new Map<string, PDFFont>();
    EMBEDDED.set(document, fonts);
  }

  const name = resourceNameFor(style);
  const existing = fonts.get(name);
  if (existing !== undefined) return existing;

  const standard = STANDARD[style.family]?.[variantOf(style)] ?? StandardFonts.Helvetica;
  const font = await document.embedFont(standard);
  fonts.set(name, font);
  return font;
}

const EMBEDDED = new WeakMap<PDFDocument, Map<string, PDFFont>>();

/**
 * Makes sure a page can draw with a style, and says what to call it.
 *
 * The same style asked for twice on the same page reuses the one resource.
 */
export async function ensureFontResource(
  document: PDFDocument,
  page: PDFPage,
  style: TextStyle,
): Promise<string> {
  const name = resourceNameFor(style);
  const resources = pageResources(document, page);
  const fonts = fontDictionary(document, resources);

  if (fonts.get(PDFName.of(name)) === undefined) {
    fonts.set(PDFName.of(name), (await standardFont(document, style)).ref);
  }
  return name;
}

/** The page's own resource dictionary, created if it inherits one. */
function pageResources(document: PDFDocument, page: PDFPage): PDFDict {
  const existing = document.context.lookupMaybe(page.node.get(PDFName.of('Resources')), PDFDict);
  if (existing !== undefined) return existing;

  const created = document.context.obj({});
  page.node.set(PDFName.of('Resources'), created);
  return created;
}

function fontDictionary(document: PDFDocument, resources: PDFDict): PDFDict {
  const existing = document.context.lookupMaybe(resources.get(PDFName.of('Font')), PDFDict);
  if (existing !== undefined) return existing;

  const created = document.context.obj({});
  resources.set(PDFName.of('Font'), created);
  return created;
}

/** True when a font resource is one PaperForge added. */
export function isReplacementFont(resourceName: string | null): boolean {
  return resourceName !== null && resourceName.startsWith(REPLACEMENT_PREFIX);
}
