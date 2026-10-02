import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { CaseSensitive, Search, SquareDashed, TextSelect, WholeWord } from 'lucide-react';
import { useCommands } from '../../commands/useCommands';
import { useDocumentStore } from '../../stores/documentStore';
import { marksFor, useRedactionStore } from '../../stores/redactionStore';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import styles from './RedactionToolbar.module.css';

/**
 * The redaction tools: mark text or areas by hand, or find text and mark
 * every occurrence, then review and apply.
 *
 * It sits under the viewer toolbar while redacting, like the comment tools.
 */
export function RedactionToolbar({ disabled }: { disabled: boolean }): ReactElement {
  const { execute } = useCommands();
  const sessionId = useDocumentStore((state) => state.activeId);
  const tool = useRedactionStore((state) => state.tool);
  const reason = useRedactionStore((state) => state.reason);
  const searching = useRedactionStore((state) => state.searching);
  const count = useRedactionStore((state) => marksFor(state.marks, sessionId).length);
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  // Escape lets go of the selected mark, unless a field or a dialog wants it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [role="dialog"]')) {
        return;
      }
      useRedactionStore.getState().select(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const store = useRedactionStore.getState;

  const find = (event: FormEvent): void => {
    event.preventDefault();
    if (sessionId === null) return;
    void store().findAndMark(sessionId, query, { matchCase, wholeWord });
  };

  return (
    <div className={styles.bar} role="toolbar" aria-label="Redaction tools">
      <div className={styles.group}>
        <IconButton
          icon={TextSelect}
          label="Mark text"
          tooltip="Mark text: select the words to remove"
          pressed={tool === 'text'}
          disabled={disabled}
          onClick={() => store().setTool('text')}
        />
        <IconButton
          icon={SquareDashed}
          label="Mark area"
          tooltip="Mark area: drag over anything to remove — text, pictures, drawings"
          pressed={tool === 'area'}
          disabled={disabled}
          onClick={() => store().setTool('area')}
        />
        <input
          className={styles.reason}
          type="text"
          value={reason}
          maxLength={120}
          placeholder="Reason (optional)"
          aria-label="Reason for new marks"
          disabled={disabled}
          onChange={(event) => store().setReason(event.target.value)}
        />
      </div>

      <span className={styles.divider} aria-hidden="true" />

      <form className={styles.group} onSubmit={find} role="search" aria-label="Find text to mark">
        <div className={styles.field}>
          <Search className={styles.fieldIcon} aria-hidden="true" strokeWidth={1.75} />
          <input
            className={styles.input}
            type="search"
            value={query}
            placeholder="Find text to mark"
            aria-label="Find text to mark"
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <IconButton
          icon={CaseSensitive}
          label="Match case"
          size="small"
          pressed={matchCase}
          disabled={disabled}
          onClick={() => setMatchCase(!matchCase)}
        />
        <IconButton
          icon={WholeWord}
          label="Whole words"
          size="small"
          pressed={wholeWord}
          disabled={disabled}
          onClick={() => setWholeWord(!wholeWord)}
        />
        <Button type="submit" disabled={disabled || searching || query.trim() === ''}>
          {searching ? 'Finding…' : 'Mark all'}
        </Button>
      </form>

      <span className={styles.spacer} />
      <span className={styles.count} aria-live="polite">
        {count === 0 ? 'Nothing marked' : `${String(count)} marked`}
      </span>
      <span className={styles.apply}>
        <Button
          appearance="primary"
          disabled={disabled || count === 0}
          onClick={() => execute('redact.apply')}
        >
          Apply Redactions…
        </Button>
      </span>
    </div>
  );
}
