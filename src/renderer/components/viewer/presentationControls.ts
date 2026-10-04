/** What a key does while presenting. */
export type PresentationAction = 'next' | 'previous' | 'first' | 'last' | 'exit';

/**
 * The keys a presenter reaches for: the arrows, Page Up and Page Down (which
 * is what a presentation clicker sends), Space and Enter forward, Backspace
 * back, Home and End, and Escape to stop. Null leaves the key alone.
 */
export function presentationKey(key: string, shiftKey: boolean): PresentationAction | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case 'Enter':
    case 'n':
    case 'N':
      return 'next';
    case ' ':
      return shiftKey ? 'previous' : 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
    case 'Backspace':
    case 'p':
    case 'P':
      return 'previous';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Escape':
      return 'exit';
    default:
      return null;
  }
}

/** The page an action leads to, kept inside the document. */
export function presentationTarget(
  action: Exclude<PresentationAction, 'exit'>,
  pageNumber: number,
  pageCount: number,
): number {
  const last = Math.max(1, pageCount);
  switch (action) {
    case 'next':
      return Math.min(last, pageNumber + 1);
    case 'previous':
      return Math.max(1, pageNumber - 1);
    case 'first':
      return 1;
    default:
      return last;
  }
}
