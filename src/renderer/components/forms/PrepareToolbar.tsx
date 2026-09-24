import type { ReactElement } from 'react';
import {
  Check,
  CircleDot,
  ClipboardList,
  List,
  Redo2,
  Save,
  Signature,
  SquareCheck,
  SquareMousePointer,
  TextCursorInput,
  Undo2,
} from 'lucide-react';
import type { FormFieldType } from '@shared/schemas/form';
import { Button } from '../controls/Button';
import { CommandIconButton } from '../controls/CommandIconButton';
import { IconButton } from '../controls/IconButton';
import { useDocumentStore } from '../../stores/documentStore';
import { formFieldsFor, useFormStore } from '../../stores/formStore';
import styles from './FillSignToolbar.module.css';

const KINDS: Array<{ id: FormFieldType; label: string; icon: typeof TextCursorInput }> = [
  { id: 'text', label: 'Text field', icon: TextCursorInput },
  { id: 'checkbox', label: 'Checkbox', icon: SquareCheck },
  { id: 'radio', label: 'Radio buttons', icon: CircleDot },
  { id: 'dropdown', label: 'Dropdown', icon: ClipboardList },
  { id: 'optionList', label: 'List', icon: List },
  { id: 'button', label: 'Button', icon: SquareMousePointer },
  { id: 'signature', label: 'Signature field', icon: Signature },
];

/**
 * The bar for making a form rather than filling one in.
 *
 * Pick a kind of field and drag where it goes; pick nothing and the pointer
 * moves and resizes the fields that are already there.
 */
export function PrepareToolbar({ disabled }: { disabled: boolean }): ReactElement {
  const sessionId = useDocumentStore((store) => store.activeId);
  const forms = useFormStore((store) => store.forms);
  const tool = useFormStore((store) => store.fieldTool);
  const busy = useFormStore((store) => store.busy);
  const selected = useFormStore((store) => store.selected);

  const fields = formFieldsFor(forms, sessionId);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Prepare form">
      <span className={styles.badge}>
        <ClipboardList className={styles.icon} aria-hidden="true" strokeWidth={1.75} />
        Prepare Form
      </span>

      {KINDS.map((kind) => (
        <IconButton
          key={kind.id}
          icon={kind.icon}
          label={kind.label}
          tooltip={`${kind.label}: drag where it goes`}
          pressed={tool === kind.id}
          disabled={disabled || busy}
          onClick={() => useFormStore.getState().setFieldTool(tool === kind.id ? null : kind.id)}
        />
      ))}

      <p className={styles.hint} aria-live="polite">
        {tool !== null
          ? 'Drag on the page where the field goes.'
          : fields.length === 0
            ? 'No fields yet. Pick a kind above and drag where it should go.'
            : selected === null
              ? `${String(fields.length)} field${fields.length === 1 ? '' : 's'}. Click one to change it.`
              : 'Drag to move it, drag a handle to resize it; the panel says what it accepts.'}
      </p>

      <div className={styles.end}>
        <CommandIconButton id="edit.undo" icon={Undo2} disabled={busy} />
        <CommandIconButton id="edit.redo" icon={Redo2} disabled={busy} />
        <CommandIconButton id="file.save" icon={Save} disabled={busy} />
        <span className={styles.divider} aria-hidden="true" />
        <Button
          appearance="primary"
          icon={Check}
          disabled={disabled}
          onClick={() => {
            useFormStore.getState().setPreparing(false);
            useFormStore.getState().setActive(false);
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
