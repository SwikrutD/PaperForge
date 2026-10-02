import type { ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { AccessibilityRect, ReadingOrder } from '@shared/schemas/accessibility';
import { cssBoxStyle, pdfRectToCss } from '../viewer/pageGeometry';
import styles from './AccessibilityLayer.module.css';

interface AccessibilityLayerProps {
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
  /** The order the tags read this page in, when it is being shown. */
  order: ReadingOrder | null;
  /** An item the reader chose in the panel, outlined on the page. */
  focused: AccessibilityRect | null;
}

/**
 * What the Accessibility Check shows on a page: the regions of the reading
 * order, numbered in the order the tags give them, text the tags leave out,
 * and the item chosen in the panel.
 *
 * It only draws. The pointer passes through to the page, so text can still be
 * selected underneath.
 */
export function AccessibilityLayer({
  geometry,
  scale,
  rotation,
  order,
  focused,
}: AccessibilityLayerProps): ReactElement {
  const place = (rect: AccessibilityRect): ReturnType<typeof cssBoxStyle> | null => {
    const box = pdfRectToCss(rect, geometry, scale, rotation);
    return box === null ? null : cssBoxStyle(box);
  };
  const focusedBox = focused === null ? null : place(focused);

  return (
    <div className={styles.layer} data-accessibility-layer={geometry.pageNumber} aria-hidden="true">
      {order?.regions.map((region) => {
        const style = place(region.rect);
        if (style === null) return null;
        return (
          <div
            key={region.order}
            className={styles.region}
            style={style}
            data-reading-order={region.order}
          >
            <span className={styles.badge}>
              {region.order}
              <span className={styles.type}>{region.type}</span>
            </span>
          </div>
        );
      })}
      {order?.untagged.map((rect, index) => {
        const style = place(rect);
        return style === null ? null : (
          <div key={`untagged-${String(index)}`} className={styles.untagged} style={style} />
        );
      })}
      {focusedBox !== null && <div className={styles.focused} style={focusedBox} />}
    </div>
  );
}
