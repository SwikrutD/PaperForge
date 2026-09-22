import fs from 'node:fs/promises';

const BOM = 0xfeff;

/** Editors and PowerShell happily write a UTF-8 BOM; JSON.parse does not accept one. */
export function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

/**
 * Reads and parses a JSON file. Returns undefined when the file does not
 * exist; any other failure (unreadable, malformed) throws, so callers can tell
 * "nothing saved yet" apart from "saved data is broken".
 */
export async function readJsonFile(filePath: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined;
    throw error;
  }
  return JSON.parse(stripByteOrderMark(text));
}
