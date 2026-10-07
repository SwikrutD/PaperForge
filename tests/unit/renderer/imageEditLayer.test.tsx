// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PdfPageGeometry } from '../../../src/pdf/render/types';
import type { ImagePlacementInput } from '../../../src/shared/schemas/edit';
import type { PageImageModel } from '../../../src/shared/schemas/image';
import { ImageEditLayer } from '../../../src/renderer/components/edit/ImageEditLayer';

/**
 * Dragging a selected image's handles on the page: corners keep its shape,
 * the handle above it turns it, and while cropping the crop has handles of
 * its own.
 */

const geometry = {
  pageNumber: 1,
  width: 600,
  height: 800,
  rotation: 0,
  viewBox: [0, 0, 600, 800],
  userUnit: 1,
  label: null,
} as unknown as PdfPageGeometry;

const placed: ImagePlacementInput = {
  x: 100,
  y: 200,
  width: 80,
  height: 40,
  rotation: 0,
  flipX: false,
  flipY: false,
};

const image: PageImageModel = {
  id: 'img-0',
  resourceName: 'Im0',
  placement: placed,
  pixelWidth: 16,
  pixelHeight: 8,
  crop: null,
  opacity: 1,
  hasAlpha: false,
  added: false,
};

beforeAll(() => {
  // jsdom has no pointer capture; the layer only needs it not to throw.
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
  });
});

function renderLayer(overrides: Partial<Parameters<typeof ImageEditLayer>[0]> = {}): ReturnType<
  typeof render
> & {
  onDrag: ReturnType<typeof vi.fn>;
  onCropDraft: ReturnType<typeof vi.fn>;
} {
  const onDrag = vi.fn();
  const onCropDraft = vi.fn();
  const view = render(
    <ImageEditLayer
      geometry={geometry}
      scale={1}
      rotation={0}
      images={[image]}
      selectedId="img-0"
      drag={null}
      placing={false}
      cropping={null}
      onSelect={vi.fn()}
      onDrag={onDrag}
      onDrop={vi.fn()}
      onPlace={vi.fn()}
      onCropDraft={onCropDraft}
      {...overrides}
    />,
  );
  return { ...view, onDrag, onCropDraft };
}

/** Drags an element by an amount on screen, from a point on screen. */
function drag(
  element: Element,
  from: { x: number; y: number },
  by: { x: number; y: number },
  shiftKey = false,
): void {
  fireEvent.pointerDown(element, { clientX: from.x, clientY: from.y, pointerId: 1, button: 0 });
  fireEvent.pointerMove(element, {
    clientX: from.x + by.x,
    clientY: from.y + by.y,
    pointerId: 1,
    shiftKey,
  });
}

describe('a corner handle', () => {
  // The box's top right corner is at (180, 560) on screen: 800 - (200 + 40).
  const corner = { x: 180, y: 560 };

  it('keeps the picture’s shape', () => {
    const { container, onDrag } = renderLayer();
    drag(container.querySelector('[data-handle="Top right"]')!, corner, { x: 40, y: 0 });

    const placement = onDrag.mock.calls.at(-1)?.[1] as ImagePlacementInput;
    expect(placement.width).toBeCloseTo(120, 6);
    expect(placement.height).toBeCloseTo(60, 6);
  });

  it('lets go of the shape with Shift', () => {
    const { container, onDrag } = renderLayer();
    drag(container.querySelector('[data-handle="Top right"]')!, corner, { x: 40, y: 0 }, true);

    const placement = onDrag.mock.calls.at(-1)?.[1] as ImagePlacementInput;
    expect(placement.width).toBeCloseTo(120, 6);
    expect(placement.height).toBeCloseTo(40, 6);
  });

  it('shows a mirrored picture’s handles where they act, not mirrored with it', () => {
    const { container } = renderLayer({
      images: [{ ...image, placement: { ...placed, flipX: true } }],
    });
    // The box is mirrored to match the picture; the handles are mirrored
    // back, so the one at the right of the screen is the right one.
    const box = container.querySelector<HTMLElement>('[data-image="img-0"]')!;
    const handle = container.querySelector<HTMLElement>('[data-handle="Top right"]')!;
    expect(box.style.transform).toContain('scaleX(-1)');
    expect(handle.parentElement?.style.transform).toBe('scaleX(-1)');
  });
});

describe('the rotation handle', () => {
  it('turns the picture about its middle, and snaps with Shift', () => {
    const { container, onDrag } = renderLayer();
    const handle = container.querySelector('[data-handle="Rotate"]')!;
    expect(handle).toHaveAttribute('aria-label', 'Rotate handle');

    // The middle is at (140, 580) on screen; swing from above it to its left.
    fireEvent.pointerDown(handle, { clientX: 140, clientY: 520, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 80, clientY: 582, pointerId: 1, shiftKey: true });

    const placement = onDrag.mock.calls.at(-1)?.[1] as ImagePlacementInput;
    expect(placement.rotation).toBe(90);
    expect(placement.width).toBe(80);
  });
});

describe('while cropping', () => {
  const cropping = { id: 'img-0', crop: { x: 0, y: 0, width: 1, height: 1 } };

  it('offers the crop’s own handles instead of the resize handles', () => {
    const { container } = renderLayer({ cropping });
    expect(container.querySelectorAll('[data-crop-handle]')).toHaveLength(8);
    expect(container.querySelector('[data-handle="Top right"]')).toBeNull();
    expect(container.querySelector('[data-handle="Rotate"]')).toBeNull();
  });

  it('trims from the edge being dragged', () => {
    const { container, onCropDraft, onDrag } = renderLayer({ cropping });
    // The left edge is at x 100; dragging it 20 right trims a quarter of 80.
    drag(
      container.querySelector('[data-crop-handle="Left"]')!,
      { x: 100, y: 580 },
      { x: 20, y: 0 },
    );

    const crop = onCropDraft.mock.calls.at(-1)?.[0] as { x: number; width: number };
    expect(crop.x).toBeCloseTo(0.25, 6);
    expect(crop.width).toBeCloseTo(0.75, 6);
    expect(onDrag).not.toHaveBeenCalled();
  });
});
