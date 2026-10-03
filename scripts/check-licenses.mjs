/**
 * Audits the licenses of everything that ships inside PaperForge.
 *
 * Reads package-lock.json — the exact versions installed — and checks every
 * package that is not development-only:
 *
 *   - its declared license must be on the permissive list below, or be an
 *     "OR" choice that includes one (PaperForge then takes that option);
 *   - anything else, including a package that declares no license at all,
 *     fails the audit unless it is listed under REVIEWED with the reason;
 *   - every direct dependency must appear in THIRD_PARTY_NOTICES.md at the
 *     version that is installed.
 *
 * `npm run licenses` exits non-zero on any failure. No network access.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ version?: string, license?: string, dev?: boolean }} LockEntry */
/** @typedef {{ packages: Record<string, LockEntry> }} Lockfile */
/** @typedef {{ dependencies?: Record<string, string>, license?: string | { type?: string } }} Manifest */

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Licenses that allow redistribution in a closed or open product with notice. */
const PERMISSIVE = new Set([
  'MIT',
  'MIT/X11',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Zlib',
  'BlueOak-1.0.0',
  'Unlicense',
  'CC0-1.0',
]);

/**
 * Packages whose license metadata the rule above cannot settle, each with the
 * finding. An entry here is a decision someone made, so it names the version:
 * an upgrade has to be looked at again.
 */
const REVIEWED = {
  'buffers@0.1.1': {
    verdict: 'release-review',
    reason:
      'Declares no license, and its upstream repository no longer exists. Reached through ' +
      'exceljs > unzipper > binary. Needs a legal review, or replacing, before PaperForge is ' +
      'redistributed. Listed in docs/RELEASE_CHECKLIST.md.',
  },
};

/**
 * "(MIT OR GPL-3.0-or-later)" is acceptable when one option is; "AND" needs every part.
 * @param {string} expression
 * @returns {boolean}
 */
function isPermissive(expression) {
  const trimmed = expression.trim().replace(/^\((.*)\)$/, '$1');
  if (/\sOR\s/.test(trimmed)) return trimmed.split(/\s+OR\s+/).some(isPermissive);
  if (/\sAND\s/.test(trimmed)) return trimmed.split(/\s+AND\s+/).every(isPermissive);
  return PERMISSIVE.has(trimmed);
}

/**
 * @param {string} relative
 * @returns {unknown}
 */
function readJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
}

/**
 * @param {LockEntry} entry
 * @param {string} location
 * @returns {string | null}
 */
function licenseOf(entry, location) {
  if (typeof entry.license === 'string') return entry.license;
  try {
    const manifest = /** @type {Manifest} */ (readJson(path.join(location, 'package.json')));
    if (typeof manifest.license === 'string') return manifest.license;
    if (manifest.license?.type !== undefined) return manifest.license.type;
  } catch {
    // Not installed; the lockfile is all there is to go on.
  }
  return null;
}

const lock = /** @type {Lockfile} */ (readJson('package-lock.json'));
const manifest = /** @type {Manifest} */ (readJson('package.json'));
const notices = readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const reviewed = [];
/** @type {Map<string, number>} */
const counts = new Map();
/** @type {Record<string, { verdict: string, reason: string } | undefined>} */
const reviewedPackages = REVIEWED;

for (const [location, entry] of Object.entries(lock.packages)) {
  if (location === '' || entry.dev === true) continue;
  const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const id = `${name}@${entry.version ?? '?'}`;
  const license = licenseOf(entry, location);
  counts.set(license ?? 'none', (counts.get(license ?? 'none') ?? 0) + 1);

  const decision = reviewedPackages[id];
  if (decision !== undefined) {
    reviewed.push(`${id} (${license ?? 'no license'}): ${decision.reason}`);
    continue;
  }
  if (license === null) failures.push(`${id} declares no license`);
  else if (!isPermissive(license)) failures.push(`${id} is ${license}`);
}

for (const name of Object.keys(manifest.dependencies ?? {})) {
  const installed = lock.packages[`node_modules/${name}`]?.version;
  if (installed === undefined) {
    failures.push(`${name} is a dependency but is not installed`);
    continue;
  }
  const row = notices.split('\n').find((line) => line.includes(`| ${installed} `));
  const named = notices.toLowerCase().includes(name.toLowerCase());
  if (!named || row === undefined) {
    failures.push(`${name}@${installed} is not listed in THIRD_PARTY_NOTICES.md at that version`);
  }
}

const summary = [...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([license, count]) => `${license} ${count}`)
  .join(', ');
process.stdout.write(`Shipped packages by license: ${summary}\n`);
for (const line of reviewed) process.stdout.write(`Reviewed: ${line}\n`);

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`License audit: ${failure}\n`);
  process.exit(1);
}
process.stdout.write('License audit passed.\n');
