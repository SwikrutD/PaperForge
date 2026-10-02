import { execFile } from 'node:child_process';
import path from 'node:path';

/**
 * The few registry operations PaperForge needs, through Windows' own reg.exe.
 *
 * Arguments are passed as an array with no shell, so a path with spaces,
 * quotes or Unicode in it is one argument whatever it contains. Every key
 * PaperForge writes is under HKEY_CURRENT_USER: nothing here needs, or asks
 * for, administrator rights.
 */

export type RegistryValueType = 'REG_SZ' | 'REG_EXPAND_SZ' | 'REG_NONE';

export interface RegistryValue {
  /** Null is the key's default value. */
  name: string | null;
  type: RegistryValueType;
  data: string;
}

export interface RegistryKey {
  key: string;
  values: RegistryValue[];
}

/** Runs reg.exe; injectable so the callers can be tested anywhere. */
export type RegRunner = (args: readonly string[]) => Promise<{ code: number; stdout: string }>;

const TIMEOUT_MS = 15_000;

export const runReg: RegRunner = (args) =>
  new Promise((resolve) => {
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
    execFile(
      path.join(systemRoot, 'System32', 'reg.exe'),
      [...args],
      { windowsHide: true, timeout: TIMEOUT_MS, encoding: 'utf8' },
      (error, stdout) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout });
      },
    );
  });

/** The arguments that write one value, creating its key if it is missing. */
export function addValueArgs(key: string, value: RegistryValue): string[] {
  return [
    'add',
    key,
    ...(value.name === null ? ['/ve'] : ['/v', value.name]),
    '/t',
    value.type,
    ...(value.type === 'REG_NONE' ? [] : ['/d', value.data]),
    '/f',
  ];
}

export async function writeKeys(
  keys: readonly RegistryKey[],
  run: RegRunner = runReg,
): Promise<boolean> {
  let ok = true;
  for (const { key, values } of keys) {
    for (const value of values) {
      const result = await run(addValueArgs(key, value));
      ok &&= result.code === 0;
    }
  }
  return ok;
}

/** Removes a key and everything under it; a key that is not there is fine. */
export async function deleteKey(key: string, run: RegRunner = runReg): Promise<void> {
  await run(['delete', key, '/f']);
}

/** Removes one value; a value that is not there is fine. */
export async function deleteValue(
  key: string,
  name: string,
  run: RegRunner = runReg,
): Promise<void> {
  await run(['delete', key, '/v', name, '/f']);
}

/** Reads one string value, or null when it is not there. */
export async function readValue(
  key: string,
  name: string | null,
  run: RegRunner = runReg,
): Promise<string | null> {
  const result = await run(['query', key, ...(name === null ? ['/ve'] : ['/v', name])]);
  if (result.code !== 0) return null;
  return parseQueryValue(result.stdout, name);
}

/**
 * Picks a value out of `reg query` output, whose lines read
 * `    Name    REG_SZ    data`. A query for the default value (`/ve`) lists
 * only that value, under a name Windows translates, so the first line is it.
 */
export function parseQueryValue(stdout: string, name: string | null): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s{4}(.*?)\s{4}(REG_[A-Z_]+)(?:\s{4}(.*))?$/.exec(line);
    if (match === null) continue;
    const [, valueName = '', , data = ''] = match;
    if (name === null || valueName.toLowerCase() === name.toLowerCase()) return data;
  }
  return null;
}
