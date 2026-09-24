import type { ReactElement } from 'react';
import {
  CalendarDays,
  Layers,
  Check,
  Eraser,
  Highlighter,
  PenTool,
  Redo2,
  Save,
  Signature,
  Undo2,
} from 'lucide-react';
import { Button } from '../controls/Button';
import { CommandIconButton } from '../controls/CommandIconButton';
import { IconButton } from '../controls/IconButton';
import { useDocumentStore } from '../../stores/documentStore';
import { formFieldsFor, missingRequired, useFormStore } from '../../stores/formStore';
import { useUiStore } from '../../stores/uiStore';
import { useSignatureStore } from '../../stores/signatureStore';
import { useAnnotationStore } from '../../stores/annotationStore';
import styles from './FillSignToolbar.module.css';

/**
 * The bar that says Fill & Sign is on.
 *
 * It says how many fields the document has, how many must still be filled in,
 * and — when the form carries JavaScript — that PaperForge does not run it,
 * so a reader is never left wondering why a total has not changed itself.
 */
export function FillSignToolbar({ disabled }: { disabled: boolean }): ReactElement {
  const sessionId = useDocumentStore((store) => store.activeId);
  const forms = useFormStore((store) => store.forms);
  const highlight = useFormStore((store) => store.highlight);
  const busy = useFormStore((store) => store.busy);
  const setHighlight = useFormStore((store) => store.setHighlight);
  const setActive = useFormStore((store) => store.setActive);

  const staged = useSignatureStore((store) => store.staged);
  const model = sessionId === null ? undefined : forms.get(sessionId)?.model;
  const fields = formFieldsFor(forms, sessionId);
  const missing = missingRequired(fields);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Fill and sign">
      <span className={styles.badge}>
        <Signature className={styles.icon} aria-hidden="true" strokeWidth={1.75} />
        Fill &amp; Sign
      </span>

      <IconButton
        icon={Highlighter}
        label="Highlight fields"
        tooltip="Tint the fields so they can be found at a glance"
        pressed={highlight}
        disabled={disabled}
        onClick={() => setHighlight(!highlight)}
      />

      <IconButton
        icon={Eraser}
        label="Empty the form"
        tooltip="Clear every field you are allowed to change"
        disabled={disabled || busy || fields.length === 0}
        onClick={() =>
          useUiStore.getState().requestConfirmation({
            title: 'Empty every field?',
            message:
              'Everything filled in will be cleared. Read-only fields keep what they hold, and this can be undone.',
            confirmLabel: 'Empty the form',
            onConfirm: () => void useFormStore.getState().clearAll(),
          })
        }
      />

      <span className={styles.divider} aria-hidden="true" />

      <IconButton
        icon={Signature}
        label="Signature"
        tooltip="Draw, type or bring in a signature"
        disabled={disabled || busy}
        onClick={() => useSignatureStore.getState().openDialog('signature')}
      />
      <IconButton
        icon={PenTool}
        label="Initials"
        tooltip="Draw, type or bring in your initials"
        disabled={disabled || busy}
        onClick={() => useSignatureStore.getState().openDialog('initials')}
      />
      <IconButton
        icon={CalendarDays}
        label="Date"
        tooltip="Put today's date on the page: drag a box for it"
        disabled={disabled || busy}
        onClick={() => {
          useAnnotationStore.getState().setPendingText(new Date().toLocaleDateString());
          useAnnotationStore.getState().setTool('freeText');
        }}
      />

      <IconButton
        icon={Layers}
        label="Flatten"
        tooltip="Draw the fields and marks onto the page itself"
        disabled={disabled || busy}
        onClick={() => useUiStore.getState().openDialog('flatten')}
      />

      <p className={styles.hint} aria-live="polite">
        {staged !== null
          ? 'Click the page where the mark should go.'
          : fields.length === 0
            ? 'This document carries no form fields. A signature can still be placed.'
            : missing.length > 0
              ? `${String(missing.length)} required field${missing.length === 1 ? '' : 's'} still to fill in.`
              : `${String(fields.length)} field${fields.length === 1 ? '' : 's'}; nothing required is missing.`}
        {model?.hasDocumentScript === true
          ? ' This form carries JavaScript, which PaperForge does not run.'
          : ''}
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
            void useFormStore.getState().commitDrafts();
            setActive(false);
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
