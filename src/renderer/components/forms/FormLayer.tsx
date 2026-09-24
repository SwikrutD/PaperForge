import type { KeyboardEvent, ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { FormFieldModel, FormValue } from '@shared/schemas/form';
import { cx } from '../../utils/classNames';
import { pdfRectToCss } from '../viewer/pageGeometry';
import styles from './FormLayer.module.css';

interface FormLayerProps {
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
  /** Every widget drawn on this page, with the field it belongs to. */
  widgets: ReadonlyArray<{ field: FormFieldModel; widgetIndex: number }>;
  /** What each field is worth right now, typed values included. */
  valueOf: (field: FormFieldModel) => FormValue | null;
  selected: string | null;
  highlight: boolean;
  /**
   * False while a mark is being placed or drawn: the fields then let the
   * pointer through, so a signature can be put down over one.
   */
  interactive: boolean;
  onSelect: (name: string) => void;
  onDraft: (name: string, value: FormValue) => void;
  /** Writes the value: leaving a field, ticking a box, choosing an option. */
  onCommit: (name: string, value?: FormValue) => void;
}

/**
 * The fields of a page, as things to fill in.
 *
 * Each widget gets a real control sitting exactly where the field is drawn,
 * so the keyboard works the way it does anywhere else: Tab moves on, Space
 * ticks, and a screen reader reads the field's name.
 *
 * What is typed is held until the field is left. Every change to a document
 * makes a new revision and redraws the page, and a sentence should be one
 * undo rather than forty.
 */
export function FormLayer({
  geometry,
  scale,
  rotation,
  widgets,
  valueOf,
  selected,
  highlight,
  interactive,
  onSelect,
  onDraft,
  onCommit,
}: FormLayerProps): ReactElement {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, field: FormFieldModel): void => {
    // Enter writes a single-line field; a multiline one takes the newline.
    if (event.key === 'Enter' && !field.multiline) {
      event.preventDefault();
      onCommit(field.name);
    }
    if (event.key === 'Escape') event.currentTarget.blur();
    event.stopPropagation();
  };

  return (
    <div
      className={cx(styles.layer, !interactive && styles.passive)}
      data-form-layer={interactive ? 'filling' : 'passive'}
    >
      {widgets.map(({ field, widgetIndex }) => {
        const widget = field.widgets[widgetIndex];
        if (widget === undefined) return null;
        const box = pdfRectToCss(widget.rect, geometry, scale, rotation);
        if (box === null) return null;

        const value = valueOf(field);
        const disabled = field.readOnly || field.type === 'button' || field.type === 'signature';
        const common = {
          'data-field': field.name,
          'data-field-type': field.type,
          'aria-label': field.tooltip ?? field.name,
          title: field.tooltip ?? field.name,
          disabled,
          onFocus: () => onSelect(field.name),
        };

        return (
          <div
            key={`${field.name}:${String(widgetIndex)}`}
            className={cx(
              styles.widget,
              highlight && styles.highlight,
              field.required && styles.required,
              selected === field.name && styles.selected,
              disabled && styles.disabled,
            )}
            style={{
              left: `${String(box.left)}px`,
              top: `${String(box.top)}px`,
              width: `${String(box.width)}px`,
              height: `${String(box.height)}px`,
            }}
          >
            {field.type === 'text' &&
              (field.multiline ? (
                <textarea
                  {...common}
                  className={styles.textarea}
                  style={{ fontSize: `${String(fontSize(field, scale))}px` }}
                  value={typeof value === 'string' ? value : ''}
                  maxLength={field.maxLength ?? undefined}
                  onChange={(event) => onDraft(field.name, event.target.value)}
                  onBlur={() => onCommit(field.name)}
                  onKeyDown={(event) => onKeyDown(event, field)}
                />
              ) : (
                <input
                  {...common}
                  className={styles.input}
                  style={{
                    fontSize: `${String(fontSize(field, scale))}px`,
                    textAlign: field.alignment ?? 'left',
                  }}
                  type={field.password ? 'password' : 'text'}
                  value={typeof value === 'string' ? value : ''}
                  maxLength={field.maxLength ?? undefined}
                  onChange={(event) => onDraft(field.name, event.target.value)}
                  onBlur={() => onCommit(field.name)}
                  onKeyDown={(event) => onKeyDown(event, field)}
                />
              ))}

            {field.type === 'checkbox' && (
              <input
                {...common}
                className={styles.tick}
                type="checkbox"
                checked={value === true}
                onChange={(event) => onCommit(field.name, event.target.checked)}
              />
            )}

            {field.type === 'radio' && (
              <input
                {...common}
                className={styles.tick}
                type="radio"
                name={field.name}
                checked={value === optionAt(field, widgetIndex)}
                onChange={() => onCommit(field.name, optionAt(field, widgetIndex))}
              />
            )}

            {(field.type === 'dropdown' || field.type === 'optionList') && (
              <select
                {...common}
                className={styles.select}
                style={{ fontSize: `${String(fontSize(field, scale))}px` }}
                multiple={field.type === 'optionList'}
                value={selectValue(field, value)}
                onChange={(event) =>
                  onCommit(
                    field.name,
                    field.type === 'optionList'
                      ? [...event.target.selectedOptions].map((option) => option.value)
                      : [event.target.value],
                  )
                }
              >
                {field.type === 'dropdown' && <option value="" />}
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}

            {(field.type === 'button' || field.type === 'signature') && (
              <span className={styles.placeholder} title={label(field)} aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** What a radio widget sets the field to: its own option. */
function optionAt(field: FormFieldModel, widgetIndex: number): string {
  return field.options?.[widgetIndex] ?? String(widgetIndex);
}

function selectValue(field: FormFieldModel, value: FormValue | null): string | string[] {
  const chosen = Array.isArray(value)
    ? value
    : typeof value === 'string' && value !== ''
      ? [value]
      : [];
  return field.type === 'optionList' ? chosen : (chosen[0] ?? '');
}

/**
 * The size the field says, scaled to the page. A size of zero means "fit the
 * box", which is what a box-height font size comes to.
 */
function fontSize(field: FormFieldModel, scale: number): number {
  const size = field.fontSize === null || field.fontSize === 0 ? 11 : field.fontSize;
  return Math.max(7, size * scale);
}

function label(field: FormFieldModel): string {
  return field.type === 'signature'
    ? `${field.name}: a signature field. PaperForge does not sign with a certificate.`
    : `${field.name}: a button. PaperForge does not run what a button would do.`;
}
