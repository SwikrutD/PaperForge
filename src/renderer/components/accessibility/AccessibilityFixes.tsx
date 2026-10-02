import { useState, type ReactElement } from 'react';
import {
  languageTagSchema,
  type AccessibilityCheck,
  type AccessibilityItem,
  type AccessibilityReport,
} from '@shared/schemas/accessibility';
import { Button } from '../controls/Button';
import { useAccessibilityStore } from '../../stores/accessibilityStore';
import { useOcrStore } from '../../stores/ocrStore';
import { useUiStore } from '../../stores/uiStore';
import form from '../overlays/dialogForm.module.css';
import { COMMON_LANGUAGES } from './checkText';
import styles from './AccessibilityPanel.module.css';

/**
 * The fixes a check can offer. Each is one undoable edit; the check runs
 * again afterwards, so the list shows what the document now says.
 */
export function CheckFix({
  check,
  report,
  sessionId,
}: {
  check: AccessibilityCheck;
  report: AccessibilityReport;
  sessionId: string;
}): ReactElement | null {
  const fix = useAccessibilityStore.getState().fix;

  if (check.status === 'passed' && check.id !== 'title' && check.id !== 'language') return null;

  switch (check.id) {
    case 'title':
      return (
        <TextFix
          label="Title"
          initial={report.title ?? ''}
          action={report.title === null ? 'Set title' : 'Change title'}
          onSave={(value) =>
            fix(sessionId, 'Set document title', [
              { kind: 'setDocumentTitle', title: value === '' ? null : value },
            ])
          }
        />
      );

    case 'language':
      return (
        <TextFix
          label="Language"
          initial={report.language ?? ''}
          action="Set language"
          placeholder="en-GB"
          suggestions="pf-languages"
          validate={(value) =>
            languageTagSchema.safeParse(value).success
              ? null
              : 'A language looks like "en" or "en-GB".'
          }
          onSave={(value) =>
            fix(sessionId, 'Set document language', [
              { kind: 'setDocumentLanguage', language: value.trim() },
            ])
          }
        />
      );

    case 'displayTitle':
      return (
        <div className={styles.fixRow}>
          <Button
            onClick={() =>
              void fix(sessionId, 'Show the title in the title bar', [
                { kind: 'setDisplayDocTitle', display: true },
              ])
            }
          >
            Show the title
          </Button>
        </div>
      );

    case 'tabOrder':
      return (
        <div className={styles.fixRow}>
          <Button
            onClick={() =>
              void fix(sessionId, 'Set the tab order to follow the tags', [
                { kind: 'setTabOrder', pages: null },
              ])
            }
          >
            Follow the tags on every page
          </Button>
        </div>
      );

    case 'imageOnlyPages':
      return (
        <div className={styles.fixRow}>
          <Button
            onClick={() => {
              const pages = check.items.flatMap((item) => (item.page === null ? [] : [item.page]));
              useOcrStore.getState().suggestPages(pages);
              useUiStore.getState().openDialog('ocr');
            }}
          >
            Recognize Text…
          </Button>
        </div>
      );

    case 'linkTargets':
      return (
        <p className={styles.hint}>
          Edit PDF lets you point a link somewhere or delete it. Choose one below to go to it.
        </p>
      );

    case 'untaggedContent':
      return (
        <p className={styles.hint}>
          Show the reading order to see where it is. Adding it to the tags needs a tagging tool.
        </p>
      );

    case 'tagged':
      return check.status === 'failed' ? (
        <p className={styles.hint}>
          Tags are best added by the program that made the document, when it exports to PDF.
        </p>
      ) : null;

    default:
      return null;
  }
}

/** A fix for one item: alternate text for a figure, or a description for a field. */
export function ItemFix({
  item,
  sessionId,
}: {
  item: AccessibilityItem;
  sessionId: string;
}): ReactElement | null {
  const fix = useAccessibilityStore.getState().fix;
  const { target } = item;

  if (target.kind === 'figure') {
    return (
      <TextFix
        label="Alternate text"
        initial={target.alt ?? ''}
        action="Save"
        multiline
        onSave={(value) =>
          fix(sessionId, value === '' ? 'Clear alternate text' : 'Set alternate text', [
            {
              kind: 'setAltText',
              path: target.path,
              expectedType: target.type,
              alt: value === '' ? null : value,
            },
          ])
        }
      />
    );
  }

  if (target.kind === 'field') {
    return (
      <TextFix
        label="Description"
        initial=""
        action="Save"
        onSave={(value) =>
          fix(sessionId, `Describe ${target.name}`, [
            { kind: 'setFieldTooltips', fields: [{ name: target.name, tooltip: value }] },
          ])
        }
      />
    );
  }

  return null;
}

function TextFix({
  label,
  initial,
  action,
  placeholder,
  suggestions,
  multiline = false,
  validate,
  onSave,
}: {
  label: string;
  initial: string;
  action: string;
  placeholder?: string;
  suggestions?: string;
  multiline?: boolean;
  validate?: (value: string) => string | null;
  onSave: (value: string) => Promise<boolean>;
}): ReactElement {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();
  const problem = trimmed === '' || validate === undefined ? null : validate(trimmed);

  const save = (): void => {
    if (problem !== null || busy) return;
    setBusy(true);
    void onSave(trimmed).finally(() => setBusy(false));
  };

  return (
    <div className={styles.fix}>
      {multiline ? (
        <textarea
          className={`${form.input} ${styles.textarea}`}
          aria-label={label}
          placeholder={placeholder ?? 'Say what it shows or means'}
          value={value}
          maxLength={2000}
          onChange={(event) => setValue(event.target.value)}
        />
      ) : (
        <input
          type="text"
          className={form.input}
          aria-label={label}
          placeholder={placeholder}
          list={suggestions}
          value={value}
          maxLength={2000}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
          }}
        />
      )}
      {suggestions === 'pf-languages' && (
        <datalist id="pf-languages">
          {COMMON_LANGUAGES.map((language) => (
            <option key={language.tag} value={language.tag}>
              {language.name}
            </option>
          ))}
        </datalist>
      )}
      {problem !== null && <p className={form.problem}>{problem}</p>}
      <div className={styles.fixRow}>
        <Button
          appearance="primary"
          disabled={busy || problem !== null || trimmed === initial.trim()}
          onClick={save}
        >
          {action}
        </Button>
      </div>
    </div>
  );
}
