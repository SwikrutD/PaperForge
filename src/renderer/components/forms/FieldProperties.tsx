import type { ReactElement } from 'react';
import type { FormFieldModel } from '@shared/schemas/form';
import { useDocumentStore } from '../../stores/documentStore';
import { formFieldsFor, missingRequired, useFormStore } from '../../stores/formStore';
import styles from '../edit/EditProperties.module.css';

const KINDS: Record<FormFieldModel['type'], string> = {
  text: 'Text',
  checkbox: 'Checkbox',
  radio: 'Radio buttons',
  dropdown: 'Dropdown',
  optionList: 'List',
  button: 'Button',
  signature: 'Signature field',
};

/**
 * What the selected field is: its name, its kind, what it will accept, and
 * whether it is one of the fields that must be filled in.
 */
export function FieldProperties(): ReactElement {
  const sessionId = useDocumentStore((store) => store.activeId);
  const forms = useFormStore((store) => store.forms);
  const selected = useFormStore((store) => store.selected);
  const problems = useFormStore((store) => store.problems);

  const fields = formFieldsFor(forms, sessionId);
  const field = fields.find((entry) => entry.name === selected);
  const missing = missingRequired(fields);

  if (field === undefined) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>
          {fields.length === 0
            ? 'This document carries no form fields. Prepare Form adds them.'
            : 'Click a field on the page to fill it in and to see what it will accept.'}
        </p>
        {missing.length > 0 && (
          <p className={styles.warning}>
            {`${String(missing.length)} field${missing.length === 1 ? '' : 's'} must be filled in: `}
            {missing
              .slice(0, 5)
              .map((entry) => entry.name)
              .join(', ')}
            {missing.length > 5 ? '…' : ''}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>{KINDS[field.type]}</h3>
        <p className={styles.sample} title={field.name}>
          {field.name}
        </p>
      </header>

      <dl className={styles.list}>
        {field.tooltip !== null && (
          <div className={styles.row}>
            <dt className={styles.label}>Says</dt>
            <dd className={styles.value}>{field.tooltip}</dd>
          </div>
        )}
        <div className={styles.row}>
          <dt className={styles.label}>Drawn on</dt>
          <dd className={styles.value}>
            {field.widgets.length === 1
              ? `Page ${String(field.widgets[0]?.page ?? 1)}`
              : `${String(field.widgets.length)} places`}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Must be filled in</dt>
          <dd className={styles.value}>{field.required ? 'Yes' : 'No'}</dd>
        </div>
        {field.readOnly && (
          <div className={styles.row}>
            <dt className={styles.label}>Read-only</dt>
            <dd className={styles.value}>Set by the document</dd>
          </div>
        )}
        {field.maxLength !== null && (
          <div className={styles.row}>
            <dt className={styles.label}>At most</dt>
            <dd className={styles.value}>{`${String(field.maxLength)} characters`}</dd>
          </div>
        )}
        {field.multiline && (
          <div className={styles.row}>
            <dt className={styles.label}>Lines</dt>
            <dd className={styles.value}>Several</dd>
          </div>
        )}
        {field.password && (
          <div className={styles.row}>
            <dt className={styles.label}>Shows</dt>
            <dd className={styles.value}>Dots, not what is typed</dd>
          </div>
        )}
        {field.rule.format !== 'text' && (
          <div className={styles.row}>
            <dt className={styles.label}>Takes</dt>
            <dd className={styles.value}>
              {field.rule.format === 'number' ? 'A number' : 'A date'}
            </dd>
          </div>
        )}
        {field.rule.calculation !== null && (
          <div className={styles.row}>
            <dt className={styles.label}>Works out</dt>
            <dd className={styles.value}>
              {`The ${field.rule.calculation.kind} of ${field.rule.calculation.fields.join(', ')}`}
            </dd>
          </div>
        )}
        {field.options !== null && (
          <div className={styles.row}>
            <dt className={styles.label}>Offers</dt>
            <dd className={styles.value}>{field.options.join(', ')}</dd>
          </div>
        )}
      </dl>

      {field.type === 'signature' && (
        <p className={styles.note}>
          A signature field the document asks for. PaperForge places a signature you draw, type or
          bring in as a picture; it does not sign with a certificate, and does not claim to.
        </p>
      )}

      {field.type === 'button' && (
        <p className={styles.note}>
          A button. Whatever it was built to do is written in the document as an action, and
          PaperForge does not run it.
        </p>
      )}

      {problems.get(field.name) !== undefined && (
        <p className={styles.warning}>{problems.get(field.name)}</p>
      )}

      {field.rule.calculation !== null && (
        <p className={styles.note}>
          PaperForge works this out itself when the fields it depends on change, and writes the
          answer into the document. No script runs.
        </p>
      )}

      {field.hasScript && (
        <p className={styles.warning}>
          This field carries JavaScript. PaperForge shows that it is there but never runs it, so
          anything it would work out is not worked out here.
        </p>
      )}
    </div>
  );
}
