/**
 * Keyboard shortcut parsing and matching.
 *
 * Chords are written the way Windows shows them — "Ctrl+K", "Ctrl+Shift+P",
 * "F11" — and parsed once into a comparable shape. Matching is
 * layout-independent for letters and digits because it compares `event.key`.
 */

export interface ShortcutBinding {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Normalized key: single characters are lower-cased, named keys keep their casing. */
  key: string;
}

const MODIFIERS = new Set(['ctrl', 'control', 'shift', 'alt', 'meta', 'win', 'cmd']);

/** Tokens people write versus the values the DOM reports. */
const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  space: ' ',
  spacebar: ' ',
  tab: 'Tab',
  del: 'Delete',
  delete: 'Delete',
  ins: 'Insert',
  insert: 'Insert',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  plus: '+',
  minus: '-',
  comma: ',',
  period: '.',
};

function normalizeKeyToken(token: string): string {
  const lower = token.toLowerCase();
  const alias = KEY_ALIASES[lower];
  if (alias !== undefined) return alias;
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
  return lower.length === 1 ? lower : token;
}

/** Parses a chord such as "Ctrl+Shift+P". Returns null when it is malformed. */
export function parseShortcut(chord: string): ShortcutBinding | null {
  const tokens = chord
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token !== '');

  // A trailing "+" means the key itself is "+", e.g. "Ctrl++".
  if (chord.endsWith('+') && !chord.endsWith('++')) return null;
  if (chord.endsWith('++')) tokens.push('+');
  if (tokens.length === 0) return null;

  const binding: ShortcutBinding = { ctrl: false, shift: false, alt: false, meta: false, key: '' };

  for (const [index, token] of tokens.entries()) {
    const lower = token.toLowerCase();
    if (MODIFIERS.has(lower)) {
      if (lower === 'ctrl' || lower === 'control') binding.ctrl = true;
      else if (lower === 'shift') binding.shift = true;
      else if (lower === 'alt') binding.alt = true;
      else binding.meta = true;
      continue;
    }
    // Only the final token may be the key itself.
    if (index !== tokens.length - 1 || binding.key !== '') return null;
    binding.key = normalizeKeyToken(token);
  }

  return binding.key === '' ? null : binding;
}

/** Normalizes a keyboard event into the same shape as a parsed chord. */
export function bindingFromEvent(event: KeyboardEvent): ShortcutBinding {
  return {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
    key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
  };
}

export function bindingsMatch(a: ShortcutBinding, b: ShortcutBinding): boolean {
  return (
    a.ctrl === b.ctrl &&
    a.shift === b.shift &&
    a.alt === b.alt &&
    a.meta === b.meta &&
    a.key === b.key
  );
}

export function matchesShortcut(event: KeyboardEvent, chord: string): boolean {
  const binding = parseShortcut(chord);
  return binding !== null && bindingsMatch(binding, bindingFromEvent(event));
}

/** Renders a chord the way Windows menus do. */
export function formatShortcut(chord: string): string {
  const binding = parseShortcut(chord);
  if (binding === null) return chord;
  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  if (binding.meta) parts.push('Win');
  parts.push(
    binding.key === ' '
      ? 'Space'
      : binding.key.length === 1
        ? binding.key.toUpperCase()
        : binding.key,
  );
  return parts.join('+');
}

/**
 * True when a key press belongs to whatever the user is typing in rather than
 * to the application. Chords that include Ctrl or Alt still get through, which
 * is what Windows apps do.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(
    type,
  );
}

export interface ShortcutEntry {
  commandId: string;
  chord: string;
  binding: ShortcutBinding;
}

/** Builds the lookup table used by the global key handler. */
export function buildShortcutTable(
  commands: readonly { id: string; shortcut?: string | undefined }[],
): ShortcutEntry[] {
  const entries: ShortcutEntry[] = [];
  for (const command of commands) {
    if (command.shortcut === undefined) continue;
    const binding = parseShortcut(command.shortcut);
    if (binding === null) continue;
    entries.push({ commandId: command.id, chord: command.shortcut, binding });
  }
  return entries;
}

/** A function key never types anything, so it belongs to the application. */
function isFunctionKey(key: string): boolean {
  return /^F\d{1,2}$/.test(key);
}

/** Finds the command a key press should run, if any. */
export function findShortcutCommand(
  event: KeyboardEvent,
  entries: readonly ShortcutEntry[],
): string | undefined {
  const pressed = bindingFromEvent(event);
  const typing = isTypingTarget(event.target);
  for (const entry of entries) {
    if (!bindingsMatch(entry.binding, pressed)) continue;
    // While typing, only modifier chords and function keys are treated as
    // application shortcuts — F3 has to keep working inside the find field.
    const application =
      entry.binding.ctrl ||
      entry.binding.alt ||
      entry.binding.meta ||
      isFunctionKey(entry.binding.key);
    if (typing && !application) continue;
    return entry.commandId;
  }
  return undefined;
}
