import { FOCUS_REGIONS, type FocusRegion } from '../types/ui';

export const FOCUS_REGION_ATTRIBUTE = 'data-focus-region';

/** Region containers currently in the document, in the documented F6 order. */
export function listRegionElements(root: ParentNode): HTMLElement[] {
  const elements: HTMLElement[] = [];
  for (const region of FOCUS_REGIONS) {
    const element = root.querySelector<HTMLElement>(`[${FOCUS_REGION_ATTRIBUTE}="${region}"]`);
    if (element !== null) elements.push(element);
  }
  return elements;
}

function regionOf(element: Element | null): HTMLElement | null {
  return element?.closest<HTMLElement>(`[${FOCUS_REGION_ATTRIBUTE}]`) ?? null;
}

/** The region that should receive focus after the one currently holding it. */
export function nextRegionElement(
  regions: readonly HTMLElement[],
  active: Element | null,
): HTMLElement | undefined {
  if (regions.length === 0) return undefined;
  const current = regionOf(active);
  const index = current === null ? -1 : regions.indexOf(current);
  return regions[(index + 1) % regions.length];
}

/**
 * Moves focus to the next major region (F6). Focus lands on the region
 * container itself, from where Tab walks its controls.
 */
export function focusNextRegion(doc: Document = document): FocusRegion | undefined {
  const regions = listRegionElements(doc);
  const target = nextRegionElement(regions, doc.activeElement);
  if (target === undefined) return undefined;
  target.focus();
  return (target.getAttribute(FOCUS_REGION_ATTRIBUTE) as FocusRegion | null) ?? undefined;
}
