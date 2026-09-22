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
}

export interface PdfSpec {
  pages: PageSpec[];
  /** Encrypts the file with 40-bit RC4 and the standard security handler. */
  password?: string;
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

export function buildPdf(spec: PdfSpec): Buffer {
  const objects: PdfObject[] = [];
  const add = (body: string | Buffer): number => {
    objects.push({ body: typeof body === 'string' ? latin1(body) : body });
    return objects.length;
  };

  // 1: catalog, 2: page tree, 3: font — fixed so the layout stays readable.
  const catalogNumber = add('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesNumber = add('placeholder');
  const fontNumber = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );

  const pageNumbers: number[] = [];
  for (const page of spec.pages) {
    const width = page.width ?? LETTER.width;
    const height = page.height ?? LETTER.height;
    const text = page.text ?? '';
    const content = `BT /F1 24 Tf 1 0 0 1 60 ${height - 80} Tm ${pdfString(text)} Tj ET\n`;
    const contentNumber = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    pageNumbers.push(
      add(
        `<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox [0 0 ${width} ${height}]` +
          `${page.rotate === undefined ? '' : ` /Rotate ${page.rotate}`}` +
          ` /Resources << /Font << /F1 ${fontNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>`,
      ),
    );
  }

  objects[pagesNumber - 1] = {
    body: latin1(
      `<< /Type /Pages /Kids [${pageNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pageNumbers.length} >>`,
    ),
  };

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
    ...(encryptNumber === undefined ? {} : { encryptNumber }),
    ...(encryptionKey === undefined ? {} : { encryptionKey }),
  });
}

interface AssembleOptions {
  root: number;
  fileId: Buffer;
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
