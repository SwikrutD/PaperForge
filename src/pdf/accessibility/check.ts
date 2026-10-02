import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFDocument,
} from 'pdf-lib';
import {
  languageTagSchema,
  type AccessibilityCheck,
  type AccessibilityCheckId,
  type AccessibilityItem,
  type AccessibilityReport,
  type AccessibilityStatus,
} from '@shared/schemas/accessibility';
import type { SecuritySummary } from '@shared/schemas/protect';
import { contentBytes, resourcesOf } from '../content/pageContent';
import { parseContent } from '../content/parser';
import { readFormFields } from '../forms/read';
import { isTagged, readLanguage, readMetadata } from '../metadata/read';
import { pageInventory } from './inventory';
import { markedStates } from './markedContent';
import { pageMarkedGeometry, propertyMcids } from './readingOrder';
import { pagesOf, readStructureTree, type StructureTree } from './structure';
import { union, type Rect } from '../redact/geometry';

/**
 * The Accessibility Check.
 *
 * Each check reads one thing out of the document and says what it found, in
 * the reader's words. What PaperForge cannot judge — whether the reading order
 * makes sense, whether the colours have enough contrast — is listed as a check
 * for a person rather than passed on PaperForge's say-so.
 */

const MAX_ITEMS = 500;
/** Types whose meaning is in a picture, which a reader needs put into words. */
const FIGURE_TYPES = new Set(['Figure', 'Formula']);
/** Pages read for geometry when locating figures; more would be slow, and the list says so. */
const MAX_GEOMETRY_PAGES = 50;
const SHOW_OPERATORS = new Set(['Tj', 'TJ', "'", '"']);

export async function checkAccessibility(
  document: PDFDocument,
  security: SecuritySummary,
): Promise<Omit<AccessibilityReport, 'revision'>> {
  const tree = readStructureTree(document);
  const tagged = isTagged(document);
  const title = readMetadata(document).title;
  const language = readLanguage(document);

  const checks: AccessibilityCheck[] = [
    checkTitle(title),
    checkDisplayTitle(document),
    checkLanguage(language),
    checkTagged(document, tree),
    await checkFigures(document, tree),
    checkImageOnlyPages(document),
    checkFieldNames(document),
    checkLinkTargets(document),
    checkLinkDescriptions(document, tree),
    checkTabOrder(document, tree),
    checkUntaggedContent(document, tree),
    checkAssistivePermission(security),
    manual(
      'readingOrder',
      tree === null
        ? 'Without tags, assistive technology guesses the order from the layout. Read the document through to judge it.'
        : 'Only a person can tell whether the order makes sense. Show the reading order to see it on each page.',
    ),
    manual(
      'colourContrast',
      'Only a person can judge whether text stands out enough from what is behind it.',
    ),
  ];

  return { checks, pageCount: document.getPageCount(), tagged, title, language };
}

// ------------------------------------------------------------- document ---

function checkTitle(title: string | null): AccessibilityCheck {
  return title !== null && title.trim() !== ''
    ? result('title', 'passed', `The document is titled "${title.trim().slice(0, 120)}".`)
    : result('title', 'failed', 'The document has no title, so readers announce its file name.');
}

function checkDisplayTitle(document: PDFDocument): AccessibilityCheck {
  const preferences = document.context.lookupMaybe(
    document.catalog.get(PDFName.of('ViewerPreferences')),
    PDFDict,
  );
  const display = preferences?.lookup(PDFName.of('DisplayDocTitle'));
  return display === PDFBool.True
    ? result('displayTitle', 'passed', 'Title bars show the document title.')
    : result(
        'displayTitle',
        'warning',
        'Title bars will show the file name rather than the document title.',
      );
}

function checkLanguage(language: string | null): AccessibilityCheck {
  if (language === null) {
    return result(
      'language',
      'failed',
      'No language is set, so screen readers may pronounce the text wrongly.',
    );
  }
  return languageTagSchema.safeParse(language).success
    ? result('language', 'passed', `The language is set to ${language}.`)
    : result('language', 'warning', `"${language}" does not look like a language tag.`);
}

function checkTagged(document: PDFDocument, tree: StructureTree | null): AccessibilityCheck {
  if (tree === null) {
    return result(
      'tagged',
      'failed',
      'The document has no tags, so assistive technology cannot tell headings, paragraphs, lists or figures apart. PaperForge can report on tags but cannot add them.',
    );
  }
  const markInfo = document.context.lookupMaybe(
    document.catalog.get(PDFName.of('MarkInfo')),
    PDFDict,
  );
  if (markInfo?.lookup(PDFName.of('Marked')) !== PDFBool.True) {
    return result(
      'tagged',
      'warning',
      'The document has a tag tree but does not declare itself tagged, so some readers will ignore it.',
    );
  }
  const count = tree.elements.length;
  return result(
    'tagged',
    'passed',
    `The document is tagged, with ${String(count)}${tree.truncated ? '+' : ''} element${count === 1 ? '' : 's'}.`,
  );
}

function checkAssistivePermission(security: SecuritySummary): AccessibilityCheck {
  if (!security.encrypted || security.permissions === null) {
    return result(
      'assistivePermission',
      'passed',
      'Nothing stops assistive technology reading the text.',
    );
  }
  return security.permissions.extractForAccessibility
    ? result(
        'assistivePermission',
        'passed',
        'The security settings let assistive technology read the text.',
      )
    : result(
        'assistivePermission',
        'failed',
        'The security settings forbid assistive technology from reading the text.',
      );
}

// -------------------------------------------------------------- figures ---

async function checkFigures(
  document: PDFDocument,
  tree: StructureTree | null,
): Promise<AccessibilityCheck> {
  if (tree === null) {
    return result(
      'figureAltText',
      'notApplicable',
      'Alternate text lives in tags, and this document has none.',
    );
  }

  const figures = tree.elements.filter((element) => FIGURE_TYPES.has(element.type));
  if (figures.length === 0) {
    return result('figureAltText', 'notApplicable', 'The tags mark no figures.');
  }

  const missing = figures.filter((figure) => !hasText(figure.alt) && !hasText(figure.actualText));
  const geometry = new Map<number, Awaited<ReturnType<typeof pageMarkedGeometry>>>();

  const items: AccessibilityItem[] = [];
  for (const figure of figures) {
    if (items.length >= MAX_ITEMS) break;
    const pageIndex = [...pagesOf(figure)].sort((a, b) => a - b)[0] ?? null;
    let rect: Rect | null = null;

    if (pageIndex !== null && (geometry.has(pageIndex) || geometry.size < MAX_GEOMETRY_PAGES)) {
      let page = geometry.get(pageIndex);
      if (page === undefined) {
        page = await pageMarkedGeometry(document, pageIndex).catch(() => ({
          byMcid: new Map<number, Rect>(),
          untagged: [],
        }));
        geometry.set(pageIndex, page);
      }
      for (const item of figure.content) {
        if (item.kind !== 'mcid') continue;
        const box = page.byMcid.get(item.mcid);
        if (box !== undefined) rect = rect === null ? box : union(rect, box);
      }
    }

    const described = hasText(figure.alt) || hasText(figure.actualText);
    items.push({
      page: pageIndex === null ? null : pageIndex + 1,
      label: described
        ? `${figure.type}: "${(figure.alt ?? figure.actualText ?? '').slice(0, 120)}"`
        : `${figure.type} without alternate text`,
      rect,
      target: { kind: 'figure', path: figure.path, type: figure.type, alt: figure.alt },
    });
  }

  return {
    id: 'figureAltText',
    status: missing.length === 0 ? 'passed' : 'failed',
    summary:
      missing.length === 0
        ? `All ${String(figures.length)} figure${figures.length === 1 ? ' has' : 's have'} alternate text.`
        : `${String(missing.length)} of ${String(figures.length)} figure${figures.length === 1 ? '' : 's'} ${missing.length === 1 ? 'has' : 'have'} no alternate text.`,
    // Figures without text come first: they are the ones to fix.
    items: items.sort(
      (a, b) =>
        Number(a.target.kind === 'figure' && hasText(a.target.alt)) -
        Number(b.target.kind === 'figure' && hasText(b.target.alt)),
    ),
    truncated: figures.length > items.length,
  };
}

// ---------------------------------------------------------------- pages ---

function checkImageOnlyPages(document: PDFDocument): AccessibilityCheck {
  const pages: number[] = [];
  for (let index = 0; index < document.getPageCount(); index += 1) {
    const inventory = pageInventory(document, index);
    if (inventory.pictures > 0 && inventory.textShows === 0) pages.push(index + 1);
  }

  if (pages.length === 0) {
    return result('imageOnlyPages', 'passed', 'Every page that shows a picture also carries text.');
  }
  return withItems(
    'imageOnlyPages',
    'failed',
    `${describePages(pages)} ${pages.length === 1 ? 'is' : 'are'} pictures with no text, most likely scans. Recognize Text reads them.`,
    pages.map((page) => ({
      page,
      label: `Page ${String(page)} has no text`,
      rect: null,
      target: { kind: 'page' },
    })),
  );
}

function checkUntaggedContent(
  document: PDFDocument,
  tree: StructureTree | null,
): AccessibilityCheck {
  if (tree === null) {
    return result('untaggedContent', 'notApplicable', 'Without tags there is nothing to compare.');
  }

  const pages: number[] = [];
  for (let index = 0; index < document.getPageCount(); index += 1) {
    const page = document.getPage(index);
    const operations = parseContent(contentBytes(document, page));
    const states = markedStates(operations, propertyMcids(document, resourcesOf(document, page)));
    const loose = operations.some(
      (operation, position) =>
        SHOW_OPERATORS.has(operation.operator) &&
        states[position]?.mcid === null &&
        states[position]?.artifact !== true,
    );
    if (loose) pages.push(index + 1);
  }

  if (pages.length === 0) {
    return result(
      'untaggedContent',
      'passed',
      'All text is either in the tags or marked as decoration.',
    );
  }
  return withItems(
    'untaggedContent',
    'warning',
    `${describePages(pages)} ${pages.length === 1 ? 'draws' : 'draw'} text the tags do not mention, which readers may skip or read out of place.`,
    pages.map((page) => ({
      page,
      label: `Untagged text on page ${String(page)}`,
      rect: null,
      target: { kind: 'page' },
    })),
  );
}

function checkTabOrder(document: PDFDocument, tree: StructureTree | null): AccessibilityCheck {
  if (tree === null) {
    return result('tabOrder', 'notApplicable', 'Tab order follows tags, and there are none.');
  }

  const pages: number[] = [];
  document.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    if (annots === undefined || annots.size() === 0) return;
    const tabs = page.node.lookup(PDFName.of('Tabs'));
    if (!(tabs instanceof PDFName) || tabs.decodeText() !== 'S') pages.push(index + 1);
  });

  if (pages.length === 0) {
    return result('tabOrder', 'passed', 'Links and fields are visited in the order of the tags.');
  }
  return withItems(
    'tabOrder',
    'failed',
    `On ${describePages(pages).toLowerCase()}, the keyboard visits links and fields in an order the tags do not set.`,
    pages.map((page) => ({
      page,
      label: `Tab order on page ${String(page)}`,
      rect: null,
      target: { kind: 'page' },
    })),
  );
}

// --------------------------------------------------------- fields, links ---

function checkFieldNames(document: PDFDocument): AccessibilityCheck {
  let fields: ReturnType<typeof readFormFields>;
  try {
    fields = readFormFields(document);
  } catch {
    return result('formFieldNames', 'warning', 'The form could not be read.');
  }
  if (fields.length === 0) {
    return result('formFieldNames', 'notApplicable', 'The document has no form fields.');
  }

  const unnamed = fields.filter((field) => !hasText(field.tooltip));
  if (unnamed.length === 0) {
    return result(
      'formFieldNames',
      'passed',
      `All ${String(fields.length)} field${fields.length === 1 ? ' has' : 's have'} a description.`,
    );
  }
  return withItems(
    'formFieldNames',
    'failed',
    `${String(unnamed.length)} of ${String(fields.length)} field${fields.length === 1 ? '' : 's'} ${unnamed.length === 1 ? 'has' : 'have'} no description, so readers announce only the internal name.`,
    unnamed.map((field) => {
      const widget = field.widgets[0];
      return {
        page: widget?.page ?? null,
        label: field.name,
        rect: widget?.rect ?? null,
        target: { kind: 'field', name: field.name },
      };
    }),
  );
}

interface FoundLink {
  page: number;
  rect: Rect | null;
  dict: PDFDict;
}

function linksOf(document: PDFDocument): FoundLink[] {
  const links: FoundLink[] = [];
  document.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    if (annots === undefined) return;
    for (let position = 0; position < annots.size(); position += 1) {
      const dict = annots.lookup(position);
      if (!(dict instanceof PDFDict)) continue;
      const subtype = dict.lookup(PDFName.of('Subtype'));
      if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Link') continue;
      links.push({ page: index + 1, rect: rectOf(dict), dict });
    }
  });
  return links;
}

function checkLinkTargets(document: PDFDocument): AccessibilityCheck {
  const links = linksOf(document);
  if (links.length === 0) {
    return result('linkTargets', 'notApplicable', 'The document has no links.');
  }

  const empty = links.filter((link) => goesNowhere(link.dict));
  if (empty.length === 0) {
    return result('linkTargets', 'passed', 'Every link goes somewhere.');
  }
  return withItems(
    'linkTargets',
    'failed',
    `${String(empty.length)} link${empty.length === 1 ? ' goes' : 's go'} nowhere.`,
    empty.map((link) => ({
      page: link.page,
      label: `Empty link on page ${String(link.page)}`,
      rect: link.rect,
      target: { kind: 'link' },
    })),
  );
}

function checkLinkDescriptions(
  document: PDFDocument,
  tree: StructureTree | null,
): AccessibilityCheck {
  const links = linksOf(document);
  if (links.length === 0) {
    return result('linkDescriptions', 'notApplicable', 'The document has no links.');
  }
  if (tree === null) {
    return result(
      'linkDescriptions',
      'notApplicable',
      'Without tags, readers describe a link by the text under it.',
    );
  }

  const bare = links.filter((link) => !hasText(textOf(link.dict.lookup(PDFName.of('Contents')))));
  if (bare.length === 0) {
    return result('linkDescriptions', 'passed', 'Every link carries a description.');
  }
  return withItems(
    'linkDescriptions',
    'warning',
    `${String(bare.length)} link${bare.length === 1 ? ' has' : 's have'} no description of where it goes.`,
    bare.map((link) => ({
      page: link.page,
      label: `Link on page ${String(link.page)}`,
      rect: link.rect,
      target: { kind: 'link' },
    })),
  );
}

/** True for a link with neither a destination nor an action that goes anywhere. */
function goesNowhere(dict: PDFDict): boolean {
  const action = dict.lookup(PDFName.of('A'));
  if (action instanceof PDFDict) {
    const kind = action.lookup(PDFName.of('S'));
    if (kind instanceof PDFName && kind.decodeText() === 'URI') {
      return !hasText(textOf(action.lookup(PDFName.of('URI'))));
    }
    return false;
  }
  const destination = dict.lookup(PDFName.of('Dest'));
  if (destination instanceof PDFArray) return destination.size() === 0;
  return destination === undefined;
}

// -------------------------------------------------------------- helpers ---

function rectOf(dict: PDFDict): Rect | null {
  const array = dict.lookup(PDFName.of('Rect'));
  if (!(array instanceof PDFArray) || array.size() < 4) return null;
  const values = [0, 1, 2, 3].map((index) => {
    const value = array.lookup(index);
    return value instanceof PDFNumber ? value.asNumber() : Number.NaN;
  });
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = values;
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function textOf(value: unknown): string | null {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
}

function hasText(value: string | null): boolean {
  return value !== null && value.trim() !== '';
}

/** "Page 3" / "Pages 2-4, 7" / "12 pages". */
function describePages(pages: readonly number[]): string {
  if (pages.length === 1) return `Page ${String(pages[0])}`;
  if (pages.length > 8) return `${String(pages.length)} pages`;
  return `Pages ${pages.join(', ')}`;
}

function result(
  id: AccessibilityCheckId,
  status: AccessibilityStatus,
  summary: string,
): AccessibilityCheck {
  return { id, status, summary, items: [], truncated: false };
}

function manual(id: AccessibilityCheckId, summary: string): AccessibilityCheck {
  return result(id, 'manual', summary);
}

function withItems(
  id: AccessibilityCheckId,
  status: AccessibilityStatus,
  summary: string,
  items: AccessibilityItem[],
): AccessibilityCheck {
  return {
    id,
    status,
    summary,
    items: items.slice(0, MAX_ITEMS),
    truncated: items.length > MAX_ITEMS,
  };
}
