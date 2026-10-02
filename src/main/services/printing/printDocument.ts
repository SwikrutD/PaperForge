import type { PrintSettings } from '@shared/schemas/print';

/** One page of a print job, as a picture beside the document. */
export interface PrintSheet {
  /** The picture's file name, relative to the print document. */
  file: string;
  /** The page's size in points as it is seen. */
  width: number;
  height: number;
}

/** Keeps a page clear of the edge most printers cannot reach. */
const SHEET_MARGIN = '0.25in';
const POINTS_PER_INCH = 72;

/**
 * Which way the paper goes. Left to PaperForge, it follows the pages: a
 * document of mostly wide pages prints on its side.
 */
export function resolveLandscape(
  orientation: PrintSettings['orientation'],
  sheets: readonly Pick<PrintSheet, 'width' | 'height'>[],
): boolean {
  if (orientation !== 'auto') return orientation === 'landscape';
  const wide = sheets.filter((sheet) => sheet.width > sheet.height).length;
  return wide > sheets.length - wide;
}

/**
 * The options Chromium's printing is given. Paper size is left alone, so the
 * printer's own default applies and the Windows dialog can change it: the
 * sheets lay themselves out from whatever paper they land on.
 */
export function toPrintOptions(
  settings: PrintSettings,
  landscape: boolean,
): Electron.WebContentsPrintOptions {
  return {
    silent: !settings.useSystemDialog,
    printBackground: true,
    ...(settings.deviceName === null ? {} : { deviceName: settings.deviceName }),
    color: settings.color,
    margins: { marginType: 'none' },
    landscape,
    copies: settings.copies,
    collate: settings.collate,
  };
}

/**
 * The document Chromium prints: one sheet per page, each a picture of the
 * page sized by the sheet's own rules.
 *
 * Fitting, centring and turning are written as CSS against the sheet rather
 * than worked out here, because only the printer knows the paper. A page is
 * turned by the `orientation` media query, which in print describes the
 * paper, so a page that is wide on tall paper is turned and one that already
 * matches is left alone.
 */
export function buildPrintDocument(input: {
  title: string;
  sheets: readonly PrintSheet[];
  settings: PrintSettings;
}): string {
  const { settings } = input;
  const body = input.sheets.map((sheet) => sheetMarkup(sheet, settings)).join('\n');
  const classes = [
    settings.scale === 'fit' ? 'fit' : 'sized',
    settings.autoRotate ? 'turn' : '',
    settings.center ? 'centre' : '',
    settings.color ? '' : 'grey',
  ]
    .filter((name) => name !== '')
    .join(' ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file:; style-src 'unsafe-inline'">
<title>${escapeHtml(input.title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body class="${classes}">
${body}
</body>
</html>
`;
}

function sheetMarkup(sheet: PrintSheet, settings: PrintSettings): string {
  const factor = settings.scale === 'custom' ? settings.customScale / 100 : 1;
  const width = (sheet.width / POINTS_PER_INCH) * factor;
  const height = (sheet.height / POINTS_PER_INCH) * factor;
  const shape = sheet.width > sheet.height ? 'wide' : 'tall';
  const style = [
    `--a:${round(sheet.width / sheet.height)}`,
    `--w:${round(width)}in`,
    `--h:${round(height)}in`,
  ].join(';');
  return `<div class="sheet ${shape}" style="${style}"><div class="frame"><img src="${encodeURI(sheet.file)}" alt=""></div></div>`;
}

const PRINT_CSS = `
@page { margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.sheet {
  --m: ${SHEET_MARGIN};
  box-sizing: border-box; width: 100vw; height: 100vh; padding: var(--m);
  display: flex; align-items: flex-start; justify-content: flex-start;
  overflow: hidden; break-after: page;
}
.sheet:last-child { break-after: auto; }
.centre .sheet { align-items: center; justify-content: center; }
.frame { position: relative; flex: none; container-type: size; }
.frame img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.grey .frame img { filter: grayscale(1); }
.fit .frame {
  aspect-ratio: var(--a);
  width: min(calc(100vw - 2 * var(--m)), calc((100vh - 2 * var(--m)) * var(--a)));
}
.sized .frame { width: var(--w); height: var(--h); }
@media (orientation: landscape) {
  .turn.fit .tall .frame {
    aspect-ratio: calc(1 / var(--a));
    width: min(calc(100vw - 2 * var(--m)), calc((100vh - 2 * var(--m)) / var(--a)));
  }
  .turn.sized .tall .frame { width: var(--h); height: var(--w); }
  .turn .tall .frame img {
    width: 100cqh; height: 100cqw; left: 50%; top: 50%;
    transform: translate(-50%, -50%) rotate(90deg);
  }
}
@media (orientation: portrait) {
  .turn.fit .wide .frame {
    aspect-ratio: calc(1 / var(--a));
    width: min(calc(100vw - 2 * var(--m)), calc((100vh - 2 * var(--m)) / var(--a)));
  }
  .turn.sized .wide .frame { width: var(--h); height: var(--w); }
  .turn .wide .frame img {
    width: 100cqh; height: 100cqw; left: 50%; top: 50%;
    transform: translate(-50%, -50%) rotate(90deg);
  }
}
`;

function round(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
