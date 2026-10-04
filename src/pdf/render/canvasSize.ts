/**
 * Canvas pixels per CSS pixel: the device pixel ratio, lowered just enough to
 * keep the canvas within `maxPixels` when there is a limit.
 */
export function canvasPixelRatio(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxPixels?: number,
): number {
  const area = cssWidth * cssHeight * devicePixelRatio * devicePixelRatio;
  if (maxPixels === undefined || area <= maxPixels || area === 0) return devicePixelRatio;
  return devicePixelRatio * Math.sqrt(maxPixels / area);
}
