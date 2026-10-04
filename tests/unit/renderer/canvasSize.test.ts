import { describe, expect, it } from 'vitest';
import { canvasPixelRatio } from '../../../src/pdf/render/canvasSize';

describe('canvasPixelRatio', () => {
  it('uses the device pixel ratio while the canvas is within the limit', () => {
    expect(canvasPixelRatio(1000, 1300, 1.5, 16_777_216)).toBe(1.5);
  });

  it('lowers the resolution of a page zoomed past the limit', () => {
    // A letter page at 1000% on a 150% display would be 9180 × 11880 pixels.
    const ratio = canvasPixelRatio(6120, 7920, 1.5, 16_777_216);
    expect(ratio).toBeLessThan(1.5);
    expect(6120 * ratio * 7920 * ratio).toBeCloseTo(16_777_216, -2);
  });

  it('has no limit unless one is asked for, as exports need', () => {
    expect(canvasPixelRatio(6120, 7920, 1.5)).toBe(1.5);
    expect(canvasPixelRatio(0, 0, 2, 100)).toBe(2);
  });
});
