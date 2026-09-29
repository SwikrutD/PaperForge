/**
 * Byte helpers shared by the renderer and the main process.
 *
 * PDF structure is written in single-byte characters, so reading it means
 * treating bytes as Latin-1 rather than decoding text. Node's Buffer is not
 * available in the renderer, which is why these are here rather than inlined.
 */

/** Chunked so a long slice does not blow the argument limit. */
const CHUNK = 8192;

/** Bytes read as Latin-1, where every byte is the character of its own value. */
export function latin1Text(bytes: Uint8Array): string {
  let text = '';
  for (let start = 0; start < bytes.length; start += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(start, Math.min(start + CHUNK, bytes.length)));
  }
  return text;
}

/** The Latin-1 bytes of a string, for comparing against a file's contents. */
export function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

/**
 * How many times a byte pattern occurs, counted without building a string —
 * which matters when the haystack is a whole document.
 */
export function countOccurrences(bytes: Uint8Array, pattern: string): number {
  const needle = latin1Bytes(pattern);
  if (needle.length === 0 || bytes.length < needle.length) return 0;

  let found = 0;
  const first = needle[0];
  outer: for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    if (bytes[index] !== first) continue;
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    found += 1;
    index += needle.length - 1;
  }
  return found;
}
