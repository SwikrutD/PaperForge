import { useLayoutEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { MovedImage } from '../../stores/imageEditStore';
import { frameStyle, imageFrame } from './imageFrame';
import styles from './ImageEditLayer.module.css';

/**
 * An image that has just been moved, resized or deleted, shown as it now is
 * until the page is drawn again: where it was is covered with the page's
 * colour, and its pixels are drawn where it now goes.
 */
export function MovedImageMark({
  moved,
  geometry,
  scale,
  rotation,
}: {
  moved: MovedImage;
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
}): ReactElement {
  const from = imageFrame(moved.from, geometry, scale, rotation);
  const to = moved.to === null ? null : imageFrame(moved.to, geometry, scale, rotation);

  return (
    <>
      {from !== null && (
        <span
          className={styles.pendingCover}
          style={frameStyle(from)}
          aria-hidden="true"
          data-pending-image-cover
        />
      )}
      {to !== null && moved.picture !== null && (
        <Picture picture={moved.picture} style={frameStyle(to)} />
      )}
    </>
  );
}

function Picture({
  picture,
  style,
}: {
  picture: HTMLCanvasElement;
  style: CSSProperties;
}): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);

  // Before the browser paints, so the first frame already has the pixels.
  useLayoutEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (canvas == null || context == null) return;
    canvas.width = picture.width;
    canvas.height = picture.height;
    context.drawImage(picture, 0, 0);
  }, [picture]);

  return (
    <canvas
      ref={ref}
      className={styles.pendingPicture}
      style={style}
      aria-hidden="true"
      data-pending-image
    />
  );
}
