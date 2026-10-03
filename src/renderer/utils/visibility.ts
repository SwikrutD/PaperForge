/**
 * One IntersectionObserver for every element that wants to know when it is
 * near the screen.
 *
 * A thumbnail list for a long document has an element per page. Giving each
 * its own observer costs more than the list itself on a document of a few
 * thousand pages; sharing one keeps opening such a document as quick as
 * opening a short one.
 */

type VisibilityListener = (visible: boolean) => void;

/** How far outside the viewport an element counts as near enough to draw. */
export const VISIBILITY_MARGIN = '200px';

const listeners = new Map<Element, VisibilityListener>();
let observer: IntersectionObserver | undefined;

function sharedObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: VISIBILITY_MARGIN },
  );
  return observer;
}

/** Calls `listener` whenever `element` comes near the screen or leaves it. Returns the undo. */
export function observeVisibility(element: Element, listener: VisibilityListener): () => void {
  listeners.set(element, listener);
  sharedObserver().observe(element);
  return () => {
    listeners.delete(element);
    observer?.unobserve(element);
  };
}
