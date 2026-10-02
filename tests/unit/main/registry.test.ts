import { describe, expect, it } from 'vitest';
import {
  addValueArgs,
  parseQueryValue,
  readValue,
  writeKeys,
  type RegRunner,
} from '../../../src/main/services/windows/registry';

describe('registry arguments', () => {
  it('passes a path with spaces, quotes and Unicode as a single argument', () => {
    const command = '"C:\\Users\\Zoë Smith\\AppData\\Local\\PaperForge\\PaperForge.exe" "%1"';
    expect(
      addValueArgs('HKCU\\Software\\Classes\\PaperForge.Document\\shell\\open\\command', {
        name: null,
        type: 'REG_SZ',
        data: command,
      }),
    ).toEqual([
      'add',
      'HKCU\\Software\\Classes\\PaperForge.Document\\shell\\open\\command',
      '/ve',
      '/t',
      'REG_SZ',
      '/d',
      command,
      '/f',
    ]);
  });

  it('writes an empty marker value without data', () => {
    expect(
      addValueArgs('HKCU\\Software\\Classes\\.pdf\\OpenWithProgids', {
        name: 'PaperForge.Document',
        type: 'REG_NONE',
        data: '',
      }),
    ).toEqual([
      'add',
      'HKCU\\Software\\Classes\\.pdf\\OpenWithProgids',
      '/v',
      'PaperForge.Document',
      '/t',
      'REG_NONE',
      '/f',
    ]);
  });

  it('reports whether every value was written', async () => {
    const calls: string[][] = [];
    const run: RegRunner = (args) => {
      calls.push([...args]);
      return Promise.resolve({ code: calls.length === 2 ? 1 : 0, stdout: '' });
    };
    const ok = await writeKeys(
      [
        {
          key: 'HKCU\\Software\\Test',
          values: [
            { name: 'A', type: 'REG_SZ', data: '1' },
            { name: 'B', type: 'REG_SZ', data: '2' },
          ],
        },
      ],
      run,
    );
    expect(ok).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe('registry queries', () => {
  const output = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows',
    '    Device    REG_SZ    Office Laser, 2nd floor,winspool,Ne01:',
    '',
  ].join('\r\n');

  it('reads a named value, keeping commas and spaces in its data', () => {
    expect(parseQueryValue(output, 'Device')).toBe('Office Laser, 2nd floor,winspool,Ne01:');
    expect(parseQueryValue(output, 'Missing')).toBeNull();
  });

  it('reads a default value whatever Windows calls it', () => {
    const localized =
      '\r\nHKEY_CURRENT_USER\\Software\\Classes\\.pdf\r\n    (Standard)    REG_SZ    AcroExch.Document\r\n';
    expect(parseQueryValue(localized, null)).toBe('AcroExch.Document');
  });

  it('treats a missing key as no value', async () => {
    const run: RegRunner = () => Promise.resolve({ code: 1, stdout: '' });
    await expect(readValue('HKCU\\Software\\Nothing', 'Device', run)).resolves.toBeNull();
  });
});
