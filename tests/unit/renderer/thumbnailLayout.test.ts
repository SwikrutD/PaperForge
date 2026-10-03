import { describe, expect, it } from 'vitest';
import type { PdfPageGeometry } from '../../../src/pdf/render/types';
import {
  layoutThumbnails,
  scrollToReveal,
  THUMBNAIL_CHROME,
  THUMBNAIL_GAP,
  THUMBNAIL_WIDTH,
} from '../../../src/renderer/components/panels/thumbnailLayout';
import { visiblePages } from '../../../src/renderer/components/viewer/viewerLayout';

function page(pageNumber: number, width = 612, height = 792): PdfPageGeometry {
  return {
    pageNumber,
    width,
    height,
    rotation: 0,
    label: null,
    viewBox: [0, 0, width, height],
    userUnit: 1,
  };
}

describe('thumbnail layout', () => {
  it('stacks entries at their pages’ proportions', () => {
    const layout = layoutThumbnails([page(1), page(2, 792, 612)]);
    const portrait = Math.round((THUMBNAIL_WIDTH * 792) / 612) + THUMBNAIL_CHROME;
    const landscape = Math.round((THUMBNAIL_WIDTH * 612) / 792) + THUMBNAIL_CHROME;

    expect(layout.boxes[0]).toMatchObject({ top: THUMBNAIL_GAP, height: portrait });
    expect(layout.boxes[1]).toMatchObject({
      top: THUMBNAIL_GAP * 2 + portrait,
      height: landscape,
    });
    expect(layout.contentHeight).toBe(THUMBNAIL_GAP * 3 + portrait + landscape);
  });

  it('mounts only the entries near the view of a long document', () => {
    const pages = Array.from({ length: 5000 }, (_, index) => page(index + 1));
    const layout = layoutThumbnails(pages);
    const box = layout.boxes[2499]!;

    const mounted = visiblePages(layout, box.top, 600);
    expect(mounted).toContain(2500);
    expect(mounted.length).toBeLessThan(20);
  });

  it('scrolls only as far as it takes to reveal an entry', () => {
    const layout = layoutThumbnails(Array.from({ length: 50 }, (_, index) => page(index + 1)));
    const tenth = layout.boxes[9]!;

    expect(scrollToReveal(layout, 1, 0, 600)).toBeNull();
    // Below the view: its bottom edge comes to the bottom of the view.
    expect(scrollToReveal(layout, 10, 0, 600)).toBe(tenth.top + tenth.height + THUMBNAIL_GAP - 600);
    // Above the view: its top comes to the top.
    expect(scrollToReveal(layout, 10, tenth.top + 1000, 600)).toBe(tenth.top - THUMBNAIL_GAP);
    expect(scrollToReveal(layout, 999, 0, 600)).toBeNull();
  });
});
