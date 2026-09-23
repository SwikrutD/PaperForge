import { describe, expect, it } from 'vitest';
import type { ImagePlacementInput } from '../../../src/shared/schemas/edit';
import {
  movedBy,
  pointAt,
  resizedBy,
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
