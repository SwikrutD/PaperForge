import type { SkippedImageReason } from '@shared/schemas/image';
import type { ImagePageStatus } from '../../stores/imageEditStore';

/**
 * What the edit bar says about the images on a page.
 *
 * It never says a page has no images when it only means the editor could not
 * reach them: a page whose images could not be read says so, and one whose
 * pictures all belong to something else says what.
 */
export function imageHint({
  pending,
  status,
  selected,
}: {
  pending: { fileName: string } | null;
  status: ImagePageStatus;
  selected: boolean;
}): string {
  if (pending !== null) return `Click the page where “${pending.fileName}” should go.`;
  if (status.state === 'loading') return 'Reading the images on this page…';
  if (status.state === 'failed') {
    return `PaperForge could not read the images on this page. ${status.message}`;
  }
  if (status.count === 0) {
    if (status.skipped.length > 0) {
      return `This page shows pictures PaperForge cannot edit here: ${status.skipped
        .map((reason) => SKIPPED[reason])
        .join('; ')}. Add image is still available.`;
    }
    return 'PaperForge finds no images it can edit on this page. Add image puts one on it.';
  }
  if (!selected) return 'Click an image to move, resize or replace it.';
  return 'Drag to move it, drag a handle to resize it; hold Shift to keep its shape.';
}

const SKIPPED: Record<SkippedImageReason, string> = {
  annotation: 'some belong to comments or stamps, which the comment tools move and remove',
  'form-unreadable': 'some are inside a drawing whose content cannot be read',
  'form-too-deep': 'some are nested in drawings too deeply to follow',
};
