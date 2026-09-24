import { inflateRawSync } from 'node:zlib';

/**
 * Reading one file out of a zip.
 *
 * A .docx, .xlsx and .pptx are each a zip of XML, so a test that wants to know
 * whether the words really made it has to look inside. Only what these tests
 * need: stored and deflated entries, no encryption, no zip64.
 */
export function readZipEntry(bytes: Uint8Array, entryName: string): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The central directory is at the end, after a record that says where it is.
  const end = findEndRecord(view, bytes.length);
  if (end === null) return null;

  let offset = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) return null;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (name === entryName) {
      return readLocalEntry(bytes, view, localOffset, method, compressedSize);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function readLocalEntry(
  bytes: Uint8Array,
  view: DataView,
  localOffset: number,
  method: number,
  compressedSize: number,
): string | null {
  if (view.getUint32(localOffset, true) !== 0x04034b50) return null;

  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + compressedSize);

  if (method === 0) return new TextDecoder().decode(data);
  if (method === 8) return new TextDecoder().decode(inflateRawSync(Buffer.from(data)));
  return null;
}

/** The end-of-central-directory record, searched for from the back. */
function findEndRecord(view: DataView, length: number): number | null {
  for (let offset = length - 22; offset >= 0 && offset > length - 65_557; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return null;
}
