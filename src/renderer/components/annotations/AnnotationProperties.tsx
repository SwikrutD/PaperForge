import type { ReactElement } from 'react';
import { Copy } from 'lucide-react';
import type {
  Annotation,
  AnnotationColor,
  AnnotationStyle,
  BuiltInStamp,
} from '@shared/schemas/annotation';
import { BUILT_IN_STAMPS, isOwnStamp } from '@shared/schemas/annotation';
import { describeKind } from '@pdf/mutate/operations';
import { formatMeasurement, measure, measuredPoints } from '@shared/utils/measure';
import { useAnnotationStore } from '../../stores/annotationStore';
import { Button } from '../controls/Button';
import { formatRelativeTime } from '../../utils/time';
import { cx } from '../../utils/classNames';
import styles from './AnnotationProperties.module.css';

/** A small palette; any colour is still reachable through the colour input. */
const SWATCHES: AnnotationColor[] = [
  { r: 0.95, g: 0.77, b: 0.06 },
  { r: 0.93, g: 0.35, b: 0.14 },
  { r: 0.8, g: 0.11, b: 0.16 },
  { r: 0.26, g: 0.63, b: 0.28 },
  { r: 0.06, g: 0.42, b: 0.74 },
  { r: 0.46, g: 0.26, b: 0.64 },
  { r: 0.15, g: 0.15, b: 0.15 },
];

function toHex(color: AnnotationColor): string {
  const channel = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function fromHex(value: string): AnnotationColor {
  const parsed = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (parsed === null) return { r: 0, g: 0, b: 0 };
  return {
    r: Number.parseInt(parsed[1] ?? '0', 16) / 255,
    g: Number.parseInt(parsed[2] ?? '0', 16) / 255,
    b: Number.parseInt(parsed[3] ?? '0', 16) / 255,
  };
}

/** True for kinds whose outline and fill mean something. */
function hasBorder(kind: string): boolean {
  return !['highlight', 'underline', 'strikeOut', 'squiggly', 'note', 'imageStamp'].includes(kind);
}

function hasFill(kind: string): boolean {
  return ['square', 'circle', 'polygon', 'freeText', 'callout'].includes(kind);
}

function hasText(kind: string): boolean {
  return ['freeText', 'callout', 'stamp'].includes(kind);
}

interface AnnotationPropertiesProps {
  /** The annotation being changed, or null for the tool's own settings. */
  annotation: Annotation | null;
}

/**
 * What a mark looks like: the properties of the selected annotation, or the
 * settings the next one will be made with.
 *
 * Changing a property of a selected annotation rewrites it in the document as
 * an undoable step; changing it with nothing selected only sets what comes
 * next, which the heading says.
 */
export function AnnotationProperties({ annotation }: AnnotationPropertiesProps): ReactElement {
  const toolStyle = useAnnotationStore((state) => state.style);
  const setStyle = useAnnotationStore((state) => state.setStyle);
  const stampLabel = useAnnotationStore((state) => state.stampLabel);
  const setStampLabel = useAnnotationStore((state) => state.setStampLabel);
  const update = useAnnotationStore((state) => state.update);

  const style = annotation?.style ?? toolStyle;
  const kind = annotation?.geometry.kind ?? 'square';
  const editable = annotation === null || annotation.editable;

  const change = (patch: Partial<AnnotationStyle>): void => {
    if (annotation === null) {
      setStyle(patch);
      return;
    }
    void update(annotation.id, { style: patch }, `Change ${describeKind(kind)}`);
  };

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <p className={styles.title}>
          {annotation === null
            ? 'New comments'
            : annotation.measure !== undefined
              ? `${annotation.measure.kind[0]?.toUpperCase() ?? ''}${annotation.measure.kind.slice(1)} measurement`
              : describeKind(kind)}
        </p>
        <p className={styles.subtitle}>
          {annotation === null
            ? 'Settings for the next mark you make.'
            : `${annotation.author === '' ? 'Unknown' : annotation.author} · page ${annotation.pageNumber}`}
        </p>
      </header>

      {annotation?.measure !== undefined && (
        <dl className={styles.measurement} data-measurement>
          <dt>Measures</dt>
          <dd>
            {formatMeasurement(
              measure(
                annotation.measure.kind,
                measuredPoints(annotation.geometry),
                annotation.measure.scale,
              ),
              annotation.measure.kind,
              annotation.measure.scale.unit,
            )}
          </dd>
          <dt>Scale</dt>
          <dd>
            {annotation.measure.scale.label === '' ? 'Not stated' : annotation.measure.scale.label}
          </dd>
        </dl>
      )}

      {!editable && (
        <p className={styles.warning}>
          This comment was made elsewhere and PaperForge cannot redraw it, so its appearance cannot
          be changed here. Its text and status still can, and it can be deleted.
        </p>
      )}

      <fieldset className={styles.group} disabled={!editable}>
        <legend className={styles.legend}>Colour</legend>
        <div className={styles.swatches}>
          {SWATCHES.map((swatch) => (
            <button
              key={toHex(swatch)}
              type="button"
              className={cx(
                styles.swatch,
                toHex(swatch) === toHex(style.color) && styles.swatchActive,
              )}
              style={{ backgroundColor: toHex(swatch) }}
              aria-label={`Colour ${toHex(swatch)}`}
              aria-pressed={toHex(swatch) === toHex(style.color)}
              onClick={() => change({ color: swatch })}
            />
          ))}
          <input
            type="color"
            className={styles.picker}
            value={toHex(style.color)}
            aria-label="Choose a colour"
            onChange={(event) => change({ color: fromHex(event.target.value) })}
          />
        </div>
      </fieldset>

      <fieldset className={styles.group} disabled={!editable}>
        <legend className={styles.legend}>Opacity</legend>
        <div className={styles.row}>
          <input
            type="range"
            className={styles.range}
            min={5}
            max={100}
            step={5}
            value={Math.round(style.opacity * 100)}
            aria-label="Opacity"
            onChange={(event) => change({ opacity: Number(event.target.value) / 100 })}
          />
          <span className={styles.value}>{Math.round(style.opacity * 100)}%</span>
        </div>
      </fieldset>

      {hasBorder(kind) && (
        <fieldset className={styles.group} disabled={!editable}>
          <legend className={styles.legend}>Line</legend>
          <div className={styles.row}>
            <input
              type="range"
              className={styles.range}
              min={0}
              max={12}
              step={0.5}
              value={style.borderWidth}
              aria-label="Line width"
              onChange={(event) => change({ borderWidth: Number(event.target.value) })}
            />
            <span className={styles.value}>{style.borderWidth.toFixed(1)}</span>
          </div>
          <div className={styles.row}>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={style.borderStyle === 'dashed'}
                onChange={(event) =>
                  change({ borderStyle: event.target.checked ? 'dashed' : 'solid' })
                }
              />
              Dashed
            </label>
          </div>
        </fieldset>
      )}

      {hasFill(kind) && (
        <fieldset className={styles.group} disabled={!editable}>
          <legend className={styles.legend}>Fill</legend>
          <div className={styles.row}>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={style.fillColor !== null}
                onChange={(event) =>
                  change({ fillColor: event.target.checked ? { r: 1, g: 1, b: 1 } : null })
                }
              />
              Filled
            </label>
            {style.fillColor !== null && (
              <input
                type="color"
                className={styles.picker}
                value={toHex(style.fillColor)}
                aria-label="Fill colour"
                onChange={(event) => change({ fillColor: fromHex(event.target.value) })}
              />
            )}
          </div>
        </fieldset>
      )}

      {hasText(kind) && (
        <fieldset className={styles.group} disabled={!editable}>
          <legend className={styles.legend}>Text</legend>
          <div className={styles.row}>
            <input
              type="range"
              className={styles.range}
              min={6}
              max={48}
              step={1}
              value={style.fontSize}
              aria-label="Font size"
              onChange={(event) => change({ fontSize: Number(event.target.value) })}
            />
            <span className={styles.value}>{style.fontSize} pt</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Colour</span>
            <input
              type="color"
              className={styles.picker}
              value={toHex(style.textColor)}
              aria-label="Text colour"
              onChange={(event) => change({ textColor: fromHex(event.target.value) })}
            />
          </div>
          <p className={styles.note}>Text is drawn in Helvetica, the font every reader has.</p>
        </fieldset>
      )}

      {annotation === null && (
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Stamp</legend>
          <select
            className={styles.select}
            value={stampLabel}
            aria-label="Stamp"
            onChange={(event) => setStampLabel(event.target.value as BuiltInStamp)}
          >
            {BUILT_IN_STAMPS.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </fieldset>
      )}

      {annotation !== null && isOwnStamp(annotation) && (
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Size and turn</legend>
          <p className={styles.note}>
            {`Turned ${String(Math.round((annotation.rotation ?? 0) * 10) / 10)}°. `}
            Drag its corners to resize it and the handle above it to turn it; hold Shift to turn in
            steps of 15°.
          </p>
          <Button
            icon={Copy}
            onClick={() => void useAnnotationStore.getState().duplicate(annotation.id)}
          >
            Duplicate
          </Button>
        </fieldset>
      )}

      {annotation !== null && annotation.modifiedAt !== null && (
        <p className={styles.note}>Changed {formatRelativeTime(annotation.modifiedAt)}.</p>
      )}
    </div>
  );
}
