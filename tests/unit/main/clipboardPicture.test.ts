import { describe, expect, it, vi } from 'vitest';
import { clipboardPicture } from '../../../src/main/services/documents/clipboardPicture';

/**
 * What a paste finds on the clipboard: a PNG or JPEG as it is, any other
 * picture converted to PNG, and nothing when there is no picture at all.
 */

function item(types: Record<string, Uint8Array | string>): {
  types: string[];
  getType: (type: string) => Promise<Blob>;
} {
  return {
    types: Object.keys(types),
    getType: (type) => Promise.resolve(new Blob([types[type] as BlobPart])),
  };
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff]);
const BMP = Uint8Array.from([0x42, 0x4d]);

describe('the picture on the clipboard', () => {
  it('is the PNG when there is one, whatever else is offered', async () => {
    const convert = vi.fn();
    const found = await clipboardPicture(
      [item({ 'text/plain': 'words', 'image/jpeg': JPEG, 'image/png': PNG })],
      convert,
    );
    expect([...(found ?? [])]).toEqual([...PNG]);
    expect(convert).not.toHaveBeenCalled();
  });

  it('is the JPEG as it is, when that is all there is', async () => {
    const found = await clipboardPicture([item({ 'image/jpeg': JPEG })], vi.fn());
    expect([...(found ?? [])]).toEqual([...JPEG]);
  });

  it('is any other picture, converted', async () => {
    const convert = vi.fn(() => PNG);
    const found = await clipboardPicture([item({ 'image/bmp': BMP })], convert);
    expect(convert).toHaveBeenCalledWith(BMP);
    expect([...(found ?? [])]).toEqual([...PNG]);
  });

  it('is nothing when the clipboard holds only text', async () => {
    expect(await clipboardPicture([item({ 'text/plain': 'words' })], vi.fn())).toBeNull();
    expect(await clipboardPicture([], vi.fn())).toBeNull();
  });
});
