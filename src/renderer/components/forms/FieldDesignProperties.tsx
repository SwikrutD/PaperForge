import { useState, type ReactElement } from 'react';
import { Check, Trash2 } from 'lucide-react';
import type { FormFieldModel, FormFieldProperties } from '@shared/schemas/form';
import { Button } from '../controls/Button';
import { useDocumentStore } from '../../stores/documentStore';
import { formFieldsFor, propertiesOf, useFormStore } from '../../stores/formStore';
import styles from '../edit/EditProperties.module.css';

/** One line per name, which is how the box is read and written. */
const NEWLINE = String.fromCharCode(10);

interface Draft {
  name: string;
  newName: string;
  options: string;
  properties: FormFieldProperties;
}

/**
 * What a field being made is: its name, what it will accept, and the choices
 * it offers.
 *
 * Changes are applied together rather than one keystroke at a time: a field's
 * name is how the rest of the form addresses it, and renaming it means making
 * it again.
 */
export function FieldDesignProperties(): ReactElement {
  const sessionId = useDocumentStore((store) => store.activeId);
  const forms = useFormStore((store) => store.forms);
  const selected = useFormStore((store) => store.selected);
  const busy = useFormStore((store) => store.busy);
  const [typed, setTyped] = useState<Draft | null>(null);

  const fields = formFieldsFor(forms, sessionId);
  const field = fields.find((entry) => entry.name === selected);
  const draft = field === undefined ? null : typed?.name === field.name ? typed : draftOf(field);

  if (field === undefined || draft === null) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>
          Pick a kind of field on the bar above and drag where it goes, or click a field to change
          it.
        </p>
      </div>
    );
  }

  const change = (patch: Partial<Draft>): void => setTyped({ ...draft, ...patch });
  const setProperty = (patch: Partial<FormFieldProperties>): void =>
    setTyped({ ...draft, properties: { ...draft.properties, ...patch } });

  const takesOptions =
    field.type === 'dropdown' || field.type === 'optionList' || field.type === 'radio';
  const takesText = field.type === 'text' || field.type === 'signature';

  const apply = (): void => {
    void useFormStore.getState().updateField(field.name, {
      ...(draft.newName.trim() !== '' && draft.newName !== field.name
        ? { newName: draft.newName.trim() }
        : {}),
      ...(takesOptions && field.type !== 'radio'
        ? {
            options: draft.options
              .split('\n')
              .map((option) => option.trim())
              .filter((option) => option !== ''),
          }
        : {}),
      properties: draft.properties,
    });
  };

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>Field</h3>
        <p className={styles.sample}>{field.type}</p>
      </header>

      <section className={styles.group}>
        <label className={styles.cropField}>
          Name
          <input
            className={styles.select}
            type="text"
            value={draft.newName}
            maxLength={200}
            aria-label="Field name"
            onChange={(event) => change({ newName: event.target.value })}
          />
        </label>

        <label className={styles.cropField}>
          Tooltip
          <input
            className={styles.select}
            type="text"
            value={draft.properties.tooltip ?? ''}
            maxLength={200}
            aria-label="Tooltip"
            onChange={(event) => setProperty({ tooltip: event.target.value })}
          />
        </label>

        <div className={styles.toggles}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={draft.properties.required}
              onChange={(event) => setProperty({ required: event.target.checked })}
            />
            Required
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={draft.properties.readOnly}
              onChange={(event) => setProperty({ readOnly: event.target.checked })}
            />
            Read-only
          </label>
        </div>

        {takesText && (
          <>
            <div className={styles.toggles}>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={draft.properties.multiline}
                  onChange={(event) => setProperty({ multiline: event.target.checked })}
                />
                Several lines
              </label>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={draft.properties.password}
                  onChange={(event) => setProperty({ password: event.target.checked })}
                />
                Hide what is typed
              </label>
            </div>

            <div className={styles.row}>
              <label className={styles.label} htmlFor="field-maxlength">
                At most
              </label>
              <input
                id="field-maxlength"
                className={styles.number}
                type="number"
                min={0}
                max={10000}
                value={draft.properties.maxLength ?? 0}
                onChange={(event) =>
                  setProperty({
                    maxLength: Number(event.target.value) > 0 ? Number(event.target.value) : null,
                  })
                }
              />
              <span className={styles.label}>characters</span>
            </div>

            <div className={styles.row}>
              <label className={styles.label} htmlFor="field-alignment">
                Text sits
              </label>
              <select
                id="field-alignment"
                className={styles.select}
                value={draft.properties.alignment}
                onChange={(event) =>
                  setProperty({
                    alignment: event.target.value as FormFieldProperties['alignment'],
                  })
                }
              >
                <option value="left">Left</option>
                <option value="center">Centred</option>
                <option value="right">Right</option>
              </select>
            </div>
          </>
        )}

        {takesOptions && (
          <label className={styles.cropField}>
            {field.type === 'radio'
              ? 'Options (made when the field was added)'
              : 'Options, one a line'}
            <textarea
              className={styles.select}
              rows={4}
              value={draft.options}
              readOnly={field.type === 'radio'}
              aria-label="Options"
              onChange={(event) => change({ options: event.target.value })}
            />
          </label>
        )}
      </section>

      {takesText && (
        <section className={styles.group}>
          <h3 className={styles.title}>What it takes</h3>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="field-format">
              Accepts
            </label>
            <select
              id="field-format"
              className={styles.select}
              value={draft.properties.rule.format}
              onChange={(event) =>
                setProperty({
                  rule: {
                    ...draft.properties.rule,
                    format: event.target.value as 'text' | 'number' | 'date',
                  },
                })
              }
            >
              <option value="text">Anything</option>
              <option value="number">A number</option>
              <option value="date">A date</option>
            </select>
          </div>

          <div className={styles.row}>
            <label className={styles.label} htmlFor="field-calc">
              Works out
            </label>
            <select
              id="field-calc"
              className={styles.select}
              value={draft.properties.rule.calculation?.kind ?? 'none'}
              onChange={(event) =>
                setProperty({
                  rule: {
                    ...draft.properties.rule,
                    calculation:
                      event.target.value === 'none'
                        ? null
                        : {
                            kind: event.target.value as 'sum' | 'product' | 'average',
                            fields: draft.properties.rule.calculation?.fields ?? [],
                          },
                  },
                })
              }
            >
              <option value="none">Nothing</option>
              <option value="sum">The sum of</option>
              <option value="product">The product of</option>
              <option value="average">The average of</option>
            </select>
          </div>

          {draft.properties.rule.calculation !== null && (
            <label className={styles.cropField}>
              From these fields, one a line
              <textarea
                className={styles.select}
                rows={3}
                aria-label="Fields to work from"
                value={draft.properties.rule.calculation.fields.join(NEWLINE)}
                onChange={(event) =>
                  setProperty({
                    rule: {
                      ...draft.properties.rule,
                      calculation: {
                        kind: draft.properties.rule.calculation?.kind ?? 'sum',
                        fields: event.target.value
                          .split(NEWLINE)
                          .map((name) => name.trim())
                          .filter((name) => name !== ''),
                      },
                    },
                  })
                }
              />
            </label>
          )}

          <p className={styles.note}>
            PaperForge works this out itself while the form is filled in. It writes no JavaScript
            into the document, and runs none.
          </p>
        </section>
      )}

      <section className={styles.group}>
        <div className={styles.actions}>
          <Button appearance="primary" icon={Check} disabled={busy} onClick={apply}>
            Apply
          </Button>
          <Button
            icon={Trash2}
            disabled={busy}
            onClick={() => void useFormStore.getState().deleteField(field.name)}
          >
            Delete
          </Button>
        </div>
      </section>

      {field.type === 'signature' && (
        <p className={styles.note}>
          A place for a signature, which PaperForge writes as a read-only field. It is somewhere to
          put a mark, not a certificate-based signature.
        </p>
      )}
    </div>
  );
}

function draftOf(field: FormFieldModel): Draft {
  return {
    name: field.name,
    newName: field.name,
    options: (field.options ?? []).join('\n'),
    properties: propertiesOf(field),
  };
}
