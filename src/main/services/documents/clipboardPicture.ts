/**
 * The picture on the clipboard, as bytes PaperForge can draw.
 *
 * Windows offers a copied picture in several forms at once. A PNG is taken as
 * it is, then a JPEG; any other picture (a bitmap, say) is converted to PNG by
 * the caller's converter. Nothing here touches Electron, so it can be tested
 * without it.
 */

/** The part of Electron's `ClipboardItem` this needs. */
export interface ClipboardEntry {
  readonly types: readonly string[];
  getType: (type: string) => Promise<unknown>;
}

const PREFERRED = ['image/png', 'image/jpeg'];

export async function clipboardPicture(
  items: readonly ClipboardEntry[],
  toPng: (bytes: Uint8Array) => Uint8Array | null,
): Promise<Uint8Array | null> {
  for (const wanted of PREFERRED) {
    const entry = items.find((candidate) => candidate.types.includes(wanted));
    if (entry !== undefined) return bytesOf(await entry.getType(wanted));
  }

  for (const entry of items) {
    const other = entry.types.find((type) => type.startsWith('image/'));
    if (other === undefined) continue;
    const bytes = await bytesOf(await entry.getType(other));
    return bytes === null ? null : toPng(bytes);
  }
  return null;
}

async function bytesOf(payload: unknown): Promise<Uint8Array | null> {
  if (!(payload instanceof Blob)) return null;
  return new Uint8Array(await payload.arrayBuffer());
}
