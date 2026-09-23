import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { AnnotationInput } from '@shared/schemas/annotation';
import { boundsOf } from '@pdf/mutate/annotations/geometry';
import { pdfRectToCss } from '../viewer/pageGeometry';
import styles from './DraftEditor.module.css';

interface DraftEditorProps {
  draft: AnnotationInput;
  pageGeometry: PdfPageGeometry;
  scale: number;
  rotation: number;
  onCommit: (contents: string) => void;
  onCancel: () => void;
}

/**
 * The box a text box or callout is typed into before it exists.
 *
 * It sits exactly where the annotation will be and uses the same size and
 * colour, so what the reader types is what the page ends up showing. Nothing
 * is written until they are finished: Escape throws the draft away.
 */
export function DraftEditor({
  draft,
  pageGeometry,
  scale,
  rotation,
  onCommit,
  onCancel,
}: DraftEditorProps): ReactElement | null {
  const [value, setValue] = useState(draft.contents);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  const rect =
    draft.geometry.kind === 'freeText' || draft.geometry.kind === 'callout'
      ? draft.geometry.rect
      : boundsOf(draft.geometry, draft.style.borderWidth);
  const box = pdfRectToCss(rect, pageGeometry, scale, rotation);
  if (box === null) return null;

  return (
    <textarea
      ref={areaRef}
      className={styles.editor}
      value={value}
      aria-label="Comment text"
      placeholder="Type the text…"
      style={{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        fontSize: `${draft.style.fontSize * scale}px`,
        color: cssColor(draft.style.textColor),
        borderColor: cssColor(draft.style.color),
      }}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
        // Enter adds a line; finishing is a click away or Ctrl+Enter.
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          onCommit(value);
        }
      }}
    />
  );
}

function cssColor(color: { r: number; g: number; b: number }): string {
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return `rgb(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)})`;
}
