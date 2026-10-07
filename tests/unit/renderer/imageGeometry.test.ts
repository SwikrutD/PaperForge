import { describe, expect, it } from 'vitest';
import type { ImagePlacementInput } from '../../../src/shared/schemas/edit';
import {
  cropDraggedBy,
  movedBy,
  nudgeFor,
  placementOfCrop,
  pointAt,
  resizeGesture,
  resizedBy,
  rotatedTo,
  turnedBy,
} from '../../../src/renderer/components/edit/imageGeometry';

/**
 * Dragging an image about: the corner the reader is not holding has to stay
 * where it is, whatever angle the image sits at.
 */

const upright: ImagePlacementInput = {
  x: 100,
  y: 200,
  width: 80,
  height: 40,
  rotation: 0,
  flipX: false,
  flipY: false,
};

describe('moving an image', () => {
  it('shifts the box and leaves everything else alone', () => {
    expect(movedBy(upright, 10, -5)).toEqual({ ...upright, x: 110, y: 195 });
  });
});

describe('resizing an image', () => {
  it('grows from the corner being dragged', () => {
    const resized = resizedBy(upright, { x: 1, y: 0 }, 20, -10);

    expect(resized.width).toBeCloseTo(100, 6);
    expect(resized.height).toBeCloseTo(50, 6);
    // The top-left corner is the one being held still.
    expect(pointAt(resized, { x: 0, y: 1 })).toEqual(pointAt(upright, { x: 0, y: 1 }));
  });

  it('holds the opposite corner still, however far the image is turned', () => {
    for (const rotation of [0, 30, 90, 200, 315]) {
      const turned = { ...upright, rotation };
      const resized = resizedBy(turned, { x: 1, y: 1 }, 12, 7);
      const before = pointAt(turned, { x: 0, y: 0 });
      const after = pointAt(resized, { x: 0, y: 0 });

      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('resizes along the image own axes when it is turned', () => {
    // Turned a quarter circle, dragging up the page makes it wider, not taller.
    const turned = { ...upright, rotation: 90 };
    const resized = resizedBy(turned, { x: 1, y: 0.5 }, 0, 20);

    expect(resized.width).toBeCloseTo(100, 6);
    expect(resized.height).toBeCloseTo(40, 6);
  });

  it('changes one dimension from the middle of an edge', () => {
    const resized = resizedBy(upright, { x: 0.5, y: 0 }, 30, -10);

    expect(resized.width).toBeCloseTo(80, 6);
    expect(resized.height).toBeCloseTo(50, 6);
  });

  it('keeps its shape when asked to', () => {
    const resized = resizedBy(upright, { x: 1, y: 1 }, 40, 0, true);

    expect(resized.width).toBeCloseTo(120, 6);
    expect(resized.height).toBeCloseTo(60, 6);
  });

  it('will not be dragged away to nothing', () => {
    const resized = resizedBy(upright, { x: 1, y: 1 }, -500, -500);

    expect(resized.width).toBeGreaterThan(0);
    expect(resized.height).toBeGreaterThan(0);
  });
});

describe('turning an image', () => {
  it('stays within one turn of the circle', () => {
    expect(turnedBy(upright, 90).rotation).toBe(90);
    expect(turnedBy({ ...upright, rotation: 330 }, 90).rotation).toBe(60);
    expect(turnedBy({ ...upright, rotation: 30 }, -90).rotation).toBe(300);
  });
});

describe('the resize a handle makes', () => {
  it('keeps the picture’s shape from a corner, unless Shift is held', () => {
    const kept = resizeGesture(upright, { x: 1, y: 1 }, 40, 0, false);
    expect(kept.width).toBeCloseTo(120, 6);
    expect(kept.height).toBeCloseTo(60, 6);

    const free = resizeGesture(upright, { x: 1, y: 1 }, 40, 0, true);
    expect(free.width).toBeCloseTo(120, 6);
    expect(free.height).toBeCloseTo(40, 6);
  });

  it('changes one dimension from an edge, Shift or not', () => {
    for (const shift of [false, true]) {
      const resized = resizeGesture(upright, { x: 1, y: 0.5 }, 40, 0, shift);
      expect(resized.width).toBeCloseTo(120, 6);
      expect(resized.height).toBeCloseTo(40, 6);
    }
  });
});

describe('turning by the rotation handle', () => {
  // The middle of the box is (140, 220); the handle starts straight above it.
  const centre = { x: 140, y: 220 };

  it('turns by the angle the pointer swings through about the middle', () => {
    // From straight above to straight left is a quarter turn anticlockwise.
    const turned = rotatedTo(upright, { x: 140, y: 300 }, { x: 60, y: 220 }, false);
    expect(turned.rotation).toBeCloseTo(90, 6);
    // The middle stays where it was.
    expect(pointAt(turned, { x: 0.5, y: 0.5 })).toEqual(centre);
  });

  it('snaps to fifteen degrees with Shift', () => {
    const angle = (37 * Math.PI) / 180;
    const to = { x: centre.x - Math.sin(angle) * 80, y: centre.y + Math.cos(angle) * 80 };
    expect(rotatedTo(upright, { x: 140, y: 300 }, to, false).rotation).toBeCloseTo(37, 6);
    expect(rotatedTo(upright, { x: 140, y: 300 }, to, true).rotation).toBe(30);
  });

  it('stays within one turn of the circle', () => {
    const turned = rotatedTo(
      { ...upright, rotation: 350 },
      { x: 140, y: 300 },
      { x: 60, y: 220 },
      true,
    );
    expect(turned.rotation).toBe(75);
  });
});

describe('dragging a crop handle', () => {
  const whole = { x: 0, y: 0, width: 1, height: 1 };

  it('trims from the edge being dragged, in the image’s own units', () => {
    // Dragging the left edge 20 points right trims a quarter of 80 points.
    const crop = cropDraggedBy(upright, whole, { x: 0, y: 0.5 }, 20, 0);
    expect(crop.x).toBeCloseTo(0.25, 6);
    expect(crop.width).toBeCloseTo(0.75, 6);
    expect(crop.y).toBe(0);
    expect(crop.height).toBe(1);
  });

  it('follows the image’s own axes when it is turned and mirrored', () => {
    // Turned a quarter anticlockwise, the image's right edge faces up the page.
    const turned = { ...upright, rotation: 90 };
    const fromTop = cropDraggedBy(turned, whole, { x: 1, y: 0.5 }, 0, -20);
    expect(fromTop.width).toBeCloseTo(0.75, 6);

    // Mirrored, the box's left edge is the image's right.
    const mirrored = { ...upright, flipX: true };
    const fromLeft = cropDraggedBy(mirrored, whole, { x: 0, y: 0.5 }, 20, 0);
    expect(fromLeft.x).toBe(0);
    expect(fromLeft.width).toBeCloseTo(0.75, 6);
  });

  it('cannot go past the picture or turn itself inside out', () => {
    const past = cropDraggedBy(upright, whole, { x: 0, y: 0 }, -50, -50);
    expect(past).toEqual(whole);

    const through = cropDraggedBy(upright, whole, { x: 0, y: 0.5 }, 500, 0);
    expect(through.width).toBeGreaterThan(0);
    expect(through.x + through.width).toBeLessThanOrEqual(1);
  });

  it('moves the whole crop when dragged from inside', () => {
    const half = { x: 0, y: 0, width: 0.5, height: 0.5 };
    const moved = cropDraggedBy(upright, half, null, 20, 10);
    expect(moved.x).toBeCloseTo(0.25, 6);
    expect(moved.y).toBeCloseTo(0.25, 6);
    expect(moved.width).toBe(0.5);

    const stopped = cropDraggedBy(upright, half, null, 500, 500);
    expect(stopped).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });
});

describe('the box a cut picture is drawn in', () => {
  it('is the part of the old box the crop showed', () => {
    const box = placementOfCrop(upright, { x: 0.25, y: 0.5, width: 0.5, height: 0.5 });
    expect(box).toEqual({ ...upright, x: 120, y: 220, width: 40, height: 20 });
  });

  it('stays where it showed when the picture is turned or mirrored', () => {
    for (const rotation of [0, 90, 33]) {
      for (const flipX of [false, true]) {
        const start = { ...upright, rotation, flipX };
        const crop = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
        const box = placementOfCrop(start, crop);
        // The middle of the crop, in the image's own units, is where the new
        // box's middle lands.
        const fraction = { x: flipX ? 1 - 0.25 : 0.25, y: 0.4 };
        const expected = pointAt(start, fraction);
        const actual = pointAt(box, { x: 0.5, y: 0.5 });
        expect(actual.x).toBeCloseTo(expected.x, 6);
        expect(actual.y).toBeCloseTo(expected.y, 6);
        expect(box.rotation).toBe(rotation);
        expect(box.width).toBeCloseTo(24, 6);
        expect(box.height).toBeCloseTo(16, 6);
      }
    }
  });
});

describe('nudging with the arrow keys', () => {
  it('moves the way the arrow points on screen', () => {
    expect(nudgeFor('ArrowUp', false, 0)).toEqual({ dx: 0, dy: 1 });
    expect(nudgeFor('ArrowLeft', true, 0)).toEqual({ dx: -10, dy: 0 });
    // With the page turned a quarter clockwise, up the screen is left on the page.
    const turned = nudgeFor('ArrowUp', false, 90);
    expect(turned?.dx).toBeCloseTo(-1, 6);
    expect(turned?.dy).toBeCloseTo(0, 6);
  });

  it('is nothing for any other key', () => {
    expect(nudgeFor('Enter', false, 0)).toBeNull();
  });
});
