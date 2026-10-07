import { createHash } from 'node:crypto';

/**
 * Small, deterministic PDFs built byte by byte.
 *
 * Nothing here is copied from a third party: every fixture is assembled from
 * the primitives below, so the tests own exactly what they assert.
 */

export interface PageSpec {
  /** Page box in PDF units. US Letter by default. */
  width?: number;
  height?: number;
  /** Rotation stored on the page, in degrees. */
  rotate?: number;
  /** Text drawn near the top of the page. */
  text?: string;
  /**
   * The page's content stream, written out as given. Takes the place of the
   * default drawing, so a test can state exactly which operators a page uses.
   */
  content?: string;
  /** Puts the page's text inside this optional content group, by name. */
  layer?: string;
  /** An image drawn on the page, as its own XObject. */
  image?: ImagePlacementSpec;
  /**
   * A form XObject in the page's resources as /Fm0. The page's `content`
   * draws it with `/Fm0 Do` where the test wants it.
   */
  form?: { content: string; bbox: [number, number, number, number] };
  /**
   * Annotation dictionaries, written out as given. A test that needs a link
   * or a widget the writer does not build can state one exactly.
   */
  annotations?: string[];
}

/** An image the page draws, with the box it is drawn in. */
export interface ImagePlacementSpec {
  /** Pixels of a solid-colour picture. */
  pixels?: { width: number; height: number };
  /** Where it goes, in PDF units. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Written into the content stream instead of the default `cm`. */
  matrix?: [number, number, number, number, number, number];
  /** False keeps the image in the resources only, for `content` to draw itself. */
  draw?: boolean;
}

/** A font resource beyond the Helvetica every fixture already has. */
export interface FontSpec {
  /** Resource name the content stream uses, without its slash. */
  name: string;
  /** Codes the font maps differently from its base encoding. */
  differences?: Record<number, string>;
  /** Widths from code 32 onwards, in thousandths. */
  widths?: number[];
  /** Codes and what they say, written as a ToUnicode CMap. */
  toUnicode?: Record<number, string>;
  /** Makes a two-byte composite font instead of a simple one. */
  composite?: boolean;
  /** The simple font's /BaseFont; Helvetica unless a test needs another. */
  baseFont?: string;
  /** Widths by CID for a composite font. */
  cidWidths?: Record<number, number>;
}

/** One outline entry. Children nest to any depth. */
export interface OutlineSpec {
  title: string;
  /** One-based page the entry points at. */
  page: number;
  bold?: boolean;
  italic?: boolean;
  /** Colour components in 0–1, as PDFs write them. */
  color?: [number, number, number];
  children?: OutlineSpec[];
}

export interface AttachmentSpec {
  fileName: string;
  content: string;
  description?: string;
}

export interface PdfSpec {
  pages: PageSpec[];
  /** Entries of the document information dictionary, written as text strings. */
  info?: Record<string, string>;
  /** An XMP metadata packet, written to the catalogue as /Metadata. */
  xmp?: string;
  /** Document-level scripts, by name. PaperForge lists them and never runs one. */
  javaScript?: Record<string, string>;
  /** An action dictionary, written out as given, for the catalogue's /OpenAction. */
  openAction?: string;
  /** Gives every page a saved thumbnail, which the sanitizer should find. */
  thumbnails?: boolean;
  /** Encrypts the file with 40-bit RC4 and the standard security handler. */
  password?: string;
  outline?: OutlineSpec[];
  /**
   * Numbers the first `romanPages` pages i, ii, iii… and the rest from 1,
   * which is how a document with a preface labels its pages.
   */
  romanPages?: number;
  attachments?: AttachmentSpec[];
  /** Optional content groups, by name, in the order the panel should show them. */
  layers?: string[];
  /** Extra fonts, added to every page's resources as /F2, /F3 and so on. */
  fonts?: FontSpec[];
}

interface PdfObject {
  /** Body without the "n 0 obj"/"endobj" wrapper. */
  body: Buffer;
}

const LETTER = { width: 612, height: 792 };

function latin1(text: string): Buffer {
  return Buffer.from(text, 'latin1');
}

/** Escapes a string for a PDF literal. */
function pdfString(value: string): string {
  return `(${value.replace(/([\\()])/g, '\\$1')})`;
}

/** Writes a solid-colour image XObject, with its samples uncompressed. */
function addImage(add: (body: string | Buffer) => number, image: ImagePlacementSpec): number {
  const width = image.pixels?.width ?? 4;
  const height = image.pixels?.height ?? 4;
  const samples = Buffer.alloc(width * height * 3);
  for (let index = 0; index < samples.length; index += 3) {
    samples[index] = 200;
    samples[index + 1] = 40;
    samples[index + 2] = 40;
  }

  return add(
    Buffer.concat([
      latin1(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${samples.length} >>\nstream\n`,
      ),
      samples,
      latin1('\nendstream'),
    ]),
  );
}

/** Writes a font dictionary, with whatever the spec asked it to carry. */
function addFont(add: (body: string | Buffer) => number, font: FontSpec): number {
  const toUnicodeNumber =
    font.toUnicode === undefined ? undefined : add(toUnicodeCMap(font.toUnicode));

  if (font.composite === true) {
    const widths = Object.entries(font.cidWidths ?? {})
      .map(([cid, width]) => `${cid} [${width}]`)
      .join(' ');
    const descendantNumber = add(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test ` +
        `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/DW 1000${widths === '' ? '' : ` /W [${widths}]`} >>`,
    );
    return add(
      `<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H ` +
        `/DescendantFonts [${descendantNumber} 0 R]` +
        `${toUnicodeNumber === undefined ? '' : ` /ToUnicode ${toUnicodeNumber} 0 R`} >>`,
    );
  }

  const differences = Object.entries(font.differences ?? {})
    .map(([code, name]) => `${code} /${name}`)
    .join(' ');
  const encoding =
    differences === ''
      ? '/WinAnsiEncoding'
      : `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${differences}] >>`;

  return add(
    `<< /Type /Font /Subtype /Type1 /BaseFont /${font.baseFont ?? 'Helvetica'} /Encoding ${encoding}` +
      `${
        font.widths === undefined
          ? ''
          : ` /FirstChar 32 /LastChar ${32 + font.widths.length - 1} /Widths [${font.widths.join(' ')}]`
      }` +
      `${toUnicodeNumber === undefined ? '' : ` /ToUnicode ${toUnicodeNumber} 0 R`} >>`,
  );
}

/** A ToUnicode CMap, in the postfix syntax a CMap is written in. */
function toUnicodeCMap(mapping: Record<number, string>): string {
  const entries = Object.entries(mapping);
  const lines = entries
    .map(([code, text]) => {
      const codeHex = Number(code).toString(16).padStart(4, '0');
      const textHex = [...text]
        .map((character) => (character.codePointAt(0) ?? 0).toString(16).padStart(4, '0'))
        .join('');
      return `<${codeHex}> <${textHex}>`;
    })
    .join('\n');

  const body =
    `/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n` +
    `1 begincodespacerange <0000> <FFFF> endcodespacerange\n` +
    `${entries.length} beginbfchar\n${lines}\nendbfchar\n` +
    `endcmap CMapName currentdict /CMap defineresource pop end end`;
  return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
}

export function buildPdf(spec: PdfSpec): Buffer {
  const objects: PdfObject[] = [];
  const add = (body: string | Buffer): number => {
    objects.push({ body: typeof body === 'string' ? latin1(body) : body });
    return objects.length;
  };

  // 1: catalog, 2: page tree, 3: font — fixed so the layout stays readable.
  const catalogNumber = add('placeholder');
  const pagesNumber = add('placeholder');
  const fontNumber = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );

  // Optional content groups come before the pages that reference them.
  const layerNumbers = new Map<string, number>();
  for (const name of spec.layers ?? []) {
    layerNumbers.set(name, add(`<< /Type /OCG /Name ${pdfString(name)} >>`));
  }

  // Extra fonts come before the pages that name them.
  const extraFonts = new Map<string, number>();
  for (const font of spec.fonts ?? []) {
    extraFonts.set(font.name, addFont(add, font));
  }

  const pageNumbers: number[] = [];
  for (const page of spec.pages) {
    const imageNumber = page.image === undefined ? undefined : addImage(add, page.image);
    const formNumber =
      page.form === undefined
        ? undefined
        : add(
            `<< /Type /XObject /Subtype /Form /BBox [${page.form.bbox.join(' ')}] ` +
              `/Resources << /Font << /F1 ${fontNumber} 0 R >> >> /Length ${page.form.content.length} >>
` +
              `stream
${page.form.content}endstream`,
          );
    const width = page.width ?? LETTER.width;
    const height = page.height ?? LETTER.height;
    const text = page.text ?? '';
    const layerNumber = page.layer === undefined ? undefined : layerNumbers.get(page.layer);
    const picture =
      page.image === undefined || page.image.draw === false
        ? ''
        : `q ${(
            page.image.matrix ?? [
              page.image.width,
              0,
              0,
              page.image.height,
              page.image.x,
              page.image.y,
            ]
          ).join(' ')} cm /Im0 Do Q\n`;
    const drawing =
      picture +
      (page.content ?? `BT /F1 24 Tf 1 0 0 1 60 ${height - 80} Tm ${pdfString(text)} Tj ET\n`);
    // Marked content ties the drawing to an optional content group.
    const content = layerNumber === undefined ? drawing : `/OC /MC0 BDC\n${drawing}EMC\n`;
    const contentNumber = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    const properties =
      layerNumber === undefined ? '' : ` /Properties << /MC0 ${layerNumber} 0 R >>`;
    const annotationNumbers = (page.annotations ?? []).map((annotation) => add(annotation));
    const annots =
      annotationNumbers.length === 0
        ? ''
        : ` /Annots [ ${annotationNumbers.map((number) => `${number} 0 R`).join(' ')} ]`;
    pageNumbers.push(
      add(
        `<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox [0 0 ${width} ${height}]` +
          `${page.rotate === undefined ? '' : ` /Rotate ${page.rotate}`}` +
          ` /Resources << ${
            imageNumber === undefined && formNumber === undefined
              ? ''
              : `/XObject << ${imageNumber === undefined ? '' : `/Im0 ${imageNumber} 0 R `}${
                  formNumber === undefined ? '' : `/Fm0 ${formNumber} 0 R `
                }>> `
          }/Font << /F1 ${fontNumber} 0 R${[...extraFonts]
            .map(([name, number]) => ` /${name} ${number} 0 R`)
            .join('')} >>${properties} >>` +
          ` /Contents ${contentNumber} 0 R${annots} >>`,
      ),
    );
  }

  objects[pagesNumber - 1] = {
    body: latin1(
      `<< /Type /Pages /Kids [${pageNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pageNumbers.length} >>`,
    ),
  };

  const catalogEntries: string[] = [`/Type /Catalog /Pages ${pagesNumber} 0 R`];

  if (spec.outline !== undefined && spec.outline.length > 0) {
    const outlineNumber = add('placeholder');
    const roots = writeOutlineLevel(add, objects, spec.outline, outlineNumber, pageNumbers);
    objects[outlineNumber - 1] = {
      body: latin1(
        `<< /Type /Outlines /First ${roots.first} 0 R /Last ${roots.last} 0 R /Count ${roots.count} >>`,
      ),
    };
    catalogEntries.push(`/Outlines ${outlineNumber} 0 R`);
  }

  if (spec.romanPages !== undefined) {
    catalogEntries.push(
      `/PageLabels << /Nums [0 << /S /r >> ${spec.romanPages} << /S /D /St 1 >>] >>`,
    );
  }

  if (spec.attachments !== undefined && spec.attachments.length > 0) {
    const names: string[] = [];
    for (const attachment of spec.attachments) {
      const streamNumber = add(
        `<< /Type /EmbeddedFile /Length ${attachment.content.length} ` +
          `/Params << /Size ${attachment.content.length} >> >>
stream
${attachment.content}
endstream`,
      );
      const specNumber = add(
        `<< /Type /Filespec /F ${pdfString(attachment.fileName)} /UF ${pdfString(attachment.fileName)}` +
          `${attachment.description === undefined ? '' : ` /Desc ${pdfString(attachment.description)}`}` +
          ` /EF << /F ${streamNumber} 0 R >> >>`,
      );
      names.push(`${pdfString(attachment.fileName)} ${specNumber} 0 R`);
    }
    const namesNumber = add(`<< /Names [${names.join(' ')}] >>`);
    catalogEntries.push(`/Names << /EmbeddedFiles ${namesNumber} 0 R >>`);
  }

  if (spec.thumbnails === true) {
    // A tiny grey picture per page: what matters is that /Thumb is there.
    const samples = Buffer.alloc(4, 128);
    pageNumbers.forEach((pageNumber) => {
      const thumbNumber = add(
        Buffer.concat([
          latin1(
            `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray ` +
              `/BitsPerComponent 8 /Length ${samples.length} >>\nstream\n`,
          ),
          samples,
          latin1('\nendstream'),
        ]),
      );
      const page = objects[pageNumber - 1] as PdfObject;
      objects[pageNumber - 1] = {
        body: latin1(page.body.toString('latin1').replace(/>>$/, ` /Thumb ${thumbNumber} 0 R >>`)),
      };
    });
  }

  if (spec.javaScript !== undefined && Object.keys(spec.javaScript).length > 0) {
    const names: string[] = [];
    for (const [name, script] of Object.entries(spec.javaScript)) {
      const actionNumber = add(`<< /S /JavaScript /JS ${pdfString(script)} >>`);
      names.push(`${pdfString(name)} ${actionNumber} 0 R`);
    }
    const namesNumber = add(`<< /Names [${names.join(' ')}] >>`);
    // A document may carry both kinds of name tree, so this merges rather than
    // replacing whatever the attachments added.
    const existing = catalogEntries.findIndex((entry) => entry.startsWith('/Names <<'));
    if (existing >= 0) {
      catalogEntries[existing] = (catalogEntries[existing] as string).replace(
        / >>$/,
        ` /JavaScript ${namesNumber} 0 R >>`,
      );
    } else {
      catalogEntries.push(`/Names << /JavaScript ${namesNumber} 0 R >>`);
    }
  }

  if (spec.openAction !== undefined) {
    catalogEntries.push(`/OpenAction ${add(spec.openAction)} 0 R`);
  }

  if (spec.xmp !== undefined) {
    catalogEntries.push(
      `/Metadata ${add(
        `<< /Type /Metadata /Subtype /XML /Length ${spec.xmp.length} >>
stream
${spec.xmp}
endstream`,
      )} 0 R`,
    );
  }

  if (spec.layers !== undefined && spec.layers.length > 0) {
    const refs = spec.layers.map((name) => `${layerNumbers.get(name) ?? 0} 0 R`).join(' ');
    catalogEntries.push(
      `/OCProperties << /OCGs [${refs}] /D << /ON [${refs}] /Order [${refs}] >> >>`,
    );
  }

  objects[catalogNumber - 1] = { body: latin1(`<< ${catalogEntries.join(' ')} >>`) };

  let infoNumber: number | undefined;
  if (spec.info !== undefined && Object.keys(spec.info).length > 0) {
    infoNumber = add(
      `<< ${Object.entries(spec.info)
        .map(([key, value]) => `/${key} ${pdfString(value)}`)
        .join(' ')} >>`,
    );
  }

  const fileId = createHash('md5').update(JSON.stringify(spec)).digest();
  let encryptNumber: number | undefined;
  let encryptionKey: Buffer | undefined;

  if (spec.password !== undefined) {
    const { key, ownerValue, userValue } = standardSecurity(spec.password, fileId);
    encryptionKey = key;
    encryptNumber = add(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -1 /O <${ownerValue.toString('hex')}> /U <${userValue.toString('hex')}> >>`,
    );
  }

  return assemble(objects, {
    root: catalogNumber,
    fileId,
    ...(infoNumber === undefined ? {} : { infoNumber }),
    ...(encryptNumber === undefined ? {} : { encryptNumber }),
    ...(encryptionKey === undefined ? {} : { encryptionKey }),
  });
}

/**
 * Writes one level of the outline tree and links the siblings together.
 *
 * Every entry is reserved before its children are written, so a child can
 * point back at its parent.
 */
function writeOutlineLevel(
  add: (body: string | Buffer) => number,
  objects: PdfObject[],
  entries: readonly OutlineSpec[],
  parentNumber: number,
  pageNumbers: readonly number[],
): { first: number; last: number; count: number } {
  const numbers = entries.map(() => add('placeholder'));

  entries.forEach((entry, index) => {
    const number = numbers[index] as number;
    const pageRef = pageNumbers[entry.page - 1];
    const parts = [`/Title ${pdfString(entry.title)}`, `/Parent ${parentNumber} 0 R`];

    const previous = numbers[index - 1];
    const next = numbers[index + 1];
    if (previous !== undefined) parts.push(`/Prev ${previous} 0 R`);
    if (next !== undefined) parts.push(`/Next ${next} 0 R`);
    if (pageRef !== undefined) parts.push(`/Dest [${pageRef} 0 R /XYZ null null null]`);

    const flags = (entry.italic === true ? 1 : 0) + (entry.bold === true ? 2 : 0);
    if (flags !== 0) parts.push(`/F ${flags}`);
    if (entry.color !== undefined) parts.push(`/C [${entry.color.join(' ')}]`);

    if (entry.children !== undefined && entry.children.length > 0) {
      const children = writeOutlineLevel(add, objects, entry.children, number, pageNumbers);
      parts.push(
        `/First ${children.first} 0 R`,
        `/Last ${children.last} 0 R`,
        // A negative count means the entry starts collapsed.
        `/Count ${children.count}`,
      );
    }

    objects[number - 1] = { body: latin1(`<< ${parts.join(' ')} >>`) };
  });

  return {
    first: numbers[0] as number,
    last: numbers[numbers.length - 1] as number,
    count: entries.length,
  };
}

interface AssembleOptions {
  root: number;
  fileId: Buffer;
  infoNumber?: number;
  encryptNumber?: number;
  encryptionKey?: Buffer;
}

function assemble(objects: PdfObject[], options: AssembleOptions): Buffer {
  const chunks: Buffer[] = [latin1('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
  const offsets: number[] = [];
  let position = chunks[0]!.length;

  objects.forEach((object, index) => {
    const number = index + 1;
    const body =
      options.encryptionKey === undefined || number === options.encryptNumber
        ? object.body
        : encryptObject(object.body, options.encryptionKey, number);

    const chunk = Buffer.concat([latin1(`${number} 0 obj\n`), body, latin1('\nendobj\n')]);
    offsets.push(position);
    position += chunk.length;
    chunks.push(chunk);
  });

  const xrefOffset = position;
  const xrefLines = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (const offset of offsets) {
    xrefLines.push(`${offset.toString().padStart(10, '0')} 00000 n `);
  }

  const id = options.fileId.toString('hex');
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root ${options.root} 0 R /ID [<${id}> <${id}>]` +
    `${options.infoNumber === undefined ? '' : ` /Info ${options.infoNumber} 0 R`}` +
    `${options.encryptNumber === undefined ? '' : ` /Encrypt ${options.encryptNumber} 0 R`} >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  chunks.push(latin1(`${xrefLines.join('\n')}\n`), latin1(trailer));
  return Buffer.concat(chunks);
}

// ------------------------------------------------------ standard security ---
/** The padding string from the PDF specification, table 3.16. */
const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function padPassword(password: string): Buffer {
  const bytes = Buffer.from(password, 'latin1').subarray(0, 32);
  return Buffer.concat([bytes, PAD]).subarray(0, 32);
}

/** RC4, which is what revision 2 of the standard handler uses. */
export function rc4(key: Buffer, data: Buffer): Buffer {
  const state = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) state[index] = index;

  let j = 0;
  for (let index = 0; index < 256; index += 1) {
    j = (j + state[index]! + key[index % key.length]!) & 0xff;
    [state[index], state[j]] = [state[j]!, state[index]!];
  }

  const output = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let index = 0; index < data.length; index += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]!) & 0xff;
    [state[i], state[j]] = [state[j]!, state[i]!];
    output[index] = data[index]! ^ state[(state[i]! + state[j]!) & 0xff]!;
  }
  return output;
}

function standardSecurity(
  password: string,
  fileId: Buffer,
): { key: Buffer; ownerValue: Buffer; userValue: Buffer } {
  const padded = padPassword(password);

  // The owner password is the user password here, which is legal and keeps the
  // fixture simple.
  const ownerKey = createHash('md5').update(padded).digest().subarray(0, 5);
  const ownerValue = rc4(ownerKey, padded);

  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-1, 0);

  const key = createHash('md5')
    .update(Buffer.concat([padded, ownerValue, permissions, fileId]))
    .digest()
    .subarray(0, 5);

  return { key, ownerValue, userValue: rc4(key, PAD) };
}

/** Per-object key, then RC4 over the whole object body. */
function encryptObject(body: Buffer, key: Buffer, objectNumber: number): Buffer {
  const extended = Buffer.concat([
    key,
    Buffer.from([
      objectNumber & 0xff,
      (objectNumber >> 8) & 0xff,
      (objectNumber >> 16) & 0xff,
      0,
      0,
    ]),
  ]);
  const objectKey = createHash('md5')
    .update(extended)
    .digest()
    .subarray(0, Math.min(key.length + 5, 16));

  // Only strings and streams are encrypted; the fixtures keep both in one
  // place, so the stream body and any literal string are handled here.
  const text = body.toString('latin1');
  const streamStart = text.indexOf('stream\n');
  if (streamStart >= 0) {
    const bodyStart = streamStart + 'stream\n'.length;
    const bodyEnd = text.lastIndexOf('\nendstream');
    const plain = body.subarray(bodyStart, bodyEnd < 0 ? body.length : bodyEnd);
    const encrypted = rc4(objectKey, plain);
    return Buffer.concat([
      latin1(`<< /Length ${encrypted.length} >>\nstream\n`),
      encrypted,
      latin1('\nendstream'),
    ]);
  }
  return body;
}

/** A plain three-page document with known text on every page. */
export function threePageDocument(): Buffer {
  return buildPdf({
    pages: [
      { text: 'PaperForge alpha page' },
      { text: 'PaperForge beta page' },
      { text: 'PaperForge gamma page' },
    ],
  });
}

/**
 * A document that exercises every navigation panel: an outline with a nested
 * entry, roman-numbered front matter, an embedded file, an optional content
 * group, and a page with no text at all.
 */
export function navigationDocument(): Buffer {
  return buildPdf({
    romanPages: 2,
    layers: ['Watermark layer'],
    pages: [
      { text: 'Preface about forging paper' },
      { text: 'Contents of the report' },
      { text: 'Findings about the invoice' },
      { text: 'Layered notice', layer: 'Watermark layer' },
      { text: '' },
    ],
    outline: [
      { title: 'Front matter', page: 1, bold: true },
      {
        title: 'Report',
        page: 3,
        color: [0.8, 0.1, 0.1],
        children: [
          { title: 'Findings', page: 3, italic: true },
          { title: 'Appendix', page: 5 },
        ],
      },
    ],
    attachments: [
      { fileName: 'notes.txt', content: 'Attached notes.', description: 'Reviewer notes' },
      { fileName: 'installer.exe', content: 'MZ not really' },
    ],
  });
}

/**
 * A five-page document whose pages are told apart by their text, with two
 * top-level bookmarks so that splitting by bookmark has somewhere to cut.
 */
export function organizeDocument(): Buffer {
  return buildPdf({
    pages: [
      { text: 'Organize page one' },
      { text: 'Organize page two' },
      { text: 'Organize page three' },
      { text: 'Organize page four' },
      { text: 'Organize page five' },
    ],
    outline: [
      { title: 'Beginning', page: 1 },
      { title: 'Middle', page: 3 },
    ],
  });
}
