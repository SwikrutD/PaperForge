import type { ReactElement } from 'react';
import type { PageBoxRect, PageBoxes } from '@shared/schemas/pages';
import { formatPageRange } from '@shared/utils/pageRange';
import { boxesForPage, useOrganizeStore } from '../../stores/organizeStore';
import styles from './PageProperties.module.css';

const BOXES: Array<{ key: 'media' | 'crop' | 'bleed' | 'trim' | 'art'; label: string }> = [
  { key: 'media', label: 'MediaBox' },
  { key: 'crop', label: 'CropBox' },
  { key: 'bleed', label: 'BleedBox' },
  { key: 'trim', label: 'TrimBox' },
  { key: 'art', label: 'ArtBox' },
];

/**
 * What a page is: the boxes it declares, its rotation and the label the
 * document prints on it.
 *
 * Only the media box is required of a PDF page. A box the page does not declare
 * is shown as not set rather than as a copy of the media box, because that is
 * the difference between a cropped page and an uncropped one.
 */
export function PageProperties(): ReactElement {
  const selection = useOrganizeStore((state) => state.selection);
  const boxes = useOrganizeStore((state) => state.boxes);

  const chosen = selection.pages;
  const pageNumber = chosen[0];
  const entry = pageNumber === undefined ? undefined : boxesForPage(boxes, pageNumber);

  if (pageNumber === undefined) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>
          Choose a page in the grid to see the boxes and numbering it declares.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>{`Page ${String(pageNumber)}`}</h3>
        <p className={styles.subtitle}>
          {chosen.length > 1
            ? `${String(chosen.length)} pages chosen: ${formatPageRange(chosen)}. Showing the first.`
            : 'Measured in points; 72 points is one inch.'}
        </p>
      </header>

      {entry === undefined ? (
        <p className={styles.empty}>The boxes of this page have not been read yet.</p>
      ) : (
        <>
          <dl className={styles.list}>
            {BOXES.map((box) => (
              <div className={styles.row} key={box.key}>
                <dt className={styles.label}>{box.label}</dt>
                <dd className={styles.value}>{describeBox(entry[box.key])}</dd>
              </div>
            ))}
          </dl>

          <dl className={styles.list}>
            <div className={styles.row}>
              <dt className={styles.label}>Rotation</dt>
              <dd className={styles.value}>{`${String(normalizeRotation(entry.rotation))}°`}</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.label}>Printed number</dt>
              <dd className={styles.value}>{entry.label ?? 'Its position'}</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.label}>Size</dt>
              <dd className={styles.value}>{describeSize(entry)}</dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}

function describeBox(box: PageBoxRect | null): string {
  if (box === null) return 'Not set';
  return `${round(box.x)}, ${round(box.y)} → ${round(box.x + box.width)}, ${round(box.y + box.height)}`;
}

/** What the page actually shows, in points and in inches. */
function describeSize(entry: PageBoxes): string {
  const box = entry.crop ?? entry.media;
  const inches = `${(box.width / 72).toFixed(2)} × ${(box.height / 72).toFixed(2)} in`;
  return `${round(box.width)} × ${round(box.height)} pt (${inches})`;
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function normalizeRotation(rotation: number): number {
  return ((Math.trunc(rotation) % 360) + 360) % 360;
}
