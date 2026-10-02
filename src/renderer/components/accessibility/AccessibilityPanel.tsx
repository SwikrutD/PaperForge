import { useEffect, useState, type ReactElement } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Hand,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type {
  AccessibilityCheck,
  AccessibilityItem,
  AccessibilityStatus,
} from '@shared/schemas/accessibility';
import { useDocumentStore } from '../../stores/documentStore';
import { reportForSession, useAccessibilityStore } from '../../stores/accessibilityStore';
import { Button } from '../controls/Button';
import { Toggle } from '../controls/Toggle';
import { cx } from '../../utils/classNames';
import { CheckFix, ItemFix } from './AccessibilityFixes';
import { CHECK_TITLES, STATUS_ORDER, STATUS_WORDS } from './checkText';
import styles from './AccessibilityPanel.module.css';

const STATUS_ICONS: Record<AccessibilityStatus, LucideIcon> = {
  failed: XCircle,
  warning: AlertTriangle,
  manual: Hand,
  passed: CheckCircle2,
  notApplicable: CircleSlash,
};

/**
 * The Accessibility Check, in the properties panel.
 *
 * Problems come first, then what to review, then what only a person can
 * judge, then what passed. Every status is a word as well as a colour, and
 * the panel says plainly that this is a check, not a certificate.
 */
export function AccessibilityPanel(): ReactElement {
  const tab = useDocumentStore((state) => {
    const active = state.activeId;
    return state.tabs.find((candidate) => candidate.session.id === active) ?? null;
  });
  const sessionId = tab?.session.id ?? null;
  const revision = tab?.edit.revision ?? 0;
  const report = useAccessibilityStore((state) => reportForSession(state, sessionId));
  const running = useAccessibilityStore((state) => state.running);
  const showReadingOrder = useAccessibilityStore((state) => state.showReadingOrder);
  const store = useAccessibilityStore.getState;

  // The check describes the document as it is: run it on opening, and again
  // whenever the document changes underneath.
  useEffect(() => {
    if (sessionId === null) return;
    void store().run(sessionId);
  }, [sessionId, revision, store]);

  if (tab === null || sessionId === null) {
    return <p className={styles.empty}>Open a document to check it.</p>;
  }

  const checks = [...(report?.checks ?? [])].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );
  const count = (status: AccessibilityStatus): number =>
    checks.filter((check) => check.status === status).length;

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>Accessibility Check</h2>
        <p className={styles.note}>
          Checks what can be read from the document&apos;s structure. It does not certify the
          document against PDF/UA or any other standard.
        </p>
      </header>

      <div className={styles.controls}>
        <Button disabled={running} onClick={() => void store().run(sessionId)}>
          {running ? 'Checking…' : 'Check again'}
        </Button>
        <Toggle
          checked={showReadingOrder}
          label="Show reading order"
          disabled={report !== null && !report.tagged}
          onChange={(checked) => store().setShowReadingOrder(checked)}
        />
      </div>
      {report !== null && !report.tagged && (
        <p className={styles.hint}>There is no reading order to show: the document has no tags.</p>
      )}

      {report === null ? (
        <p className={styles.empty}>{running ? 'Checking the document…' : 'Not checked yet.'}</p>
      ) : (
        <>
          <p className={styles.counts} aria-live="polite">
            {`${String(count('failed'))} problem${count('failed') === 1 ? '' : 's'} · ${String(count('warning'))} to review · ${String(count('manual'))} to check by hand · ${String(count('passed'))} passed`}
          </p>
          <ul className={styles.checks}>
            {checks.map((check) => (
              <CheckEntry
                key={check.id}
                check={check}
                sessionId={sessionId}
                onFix={<CheckFix check={check} report={report} sessionId={sessionId} />}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CheckEntry({
  check,
  sessionId,
  onFix,
}: {
  check: AccessibilityCheck;
  sessionId: string;
  onFix: ReactElement;
}): ReactElement {
  const needsAttention = check.status === 'failed' || check.status === 'warning';
  const [open, setOpen] = useState(needsAttention);
  const Icon = STATUS_ICONS[check.status];
  const title = CHECK_TITLES[check.id];

  return (
    <li className={cx(styles.check, styles[check.status])} data-check={check.id}>
      <button
        type="button"
        className={styles.checkHeader}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown className={styles.twisty} aria-hidden="true" />
        ) : (
          <ChevronRight className={styles.twisty} aria-hidden="true" />
        )}
        <Icon className={styles.statusIcon} aria-hidden="true" />
        <span className={styles.checkTitle}>{title}</span>
        <span className={styles.statusWord}>{STATUS_WORDS[check.status]}</span>
      </button>

      {open && (
        <div className={styles.checkBody}>
          <p className={styles.summary}>{check.summary}</p>
          {onFix}
          {check.items.length > 0 && (
            <ul className={styles.items} aria-label={`${title}: where`}>
              {check.items.map((item, index) => (
                <ItemEntry
                  key={`${check.id}-${String(index)}`}
                  itemKey={`${check.id}-${String(index)}`}
                  item={item}
                  sessionId={sessionId}
                />
              ))}
            </ul>
          )}
          {check.truncated && (
            <p className={styles.hint}>Only the first {check.items.length} are listed.</p>
          )}
        </div>
      )}
    </li>
  );
}

function ItemEntry({
  itemKey,
  item,
  sessionId,
}: {
  itemKey: string;
  item: AccessibilityItem;
  sessionId: string;
}): ReactElement {
  const focused = useAccessibilityStore((state) => state.focused);
  const updateView = useDocumentStore((state) => state.updateView);
  const selected = focused?.sessionId === sessionId && focused.key === itemKey;
  const fixable = item.target.kind === 'figure' || item.target.kind === 'field';

  const go = (): void => {
    if (item.page !== null) updateView(sessionId, { pendingPage: item.page });
    useAccessibilityStore
      .getState()
      .focus({ key: itemKey, sessionId, page: item.page, rect: item.rect });
  };

  return (
    <li className={cx(styles.item, selected && styles.itemSelected)}>
      <button
        type="button"
        className={styles.itemButton}
        disabled={item.page === null && !fixable}
        onClick={go}
      >
        <span className={styles.itemLabel}>{item.label}</span>
        {item.page !== null && <span className={styles.itemPage}>{`p. ${String(item.page)}`}</span>}
      </button>
      {fixable && selected && <ItemFix item={item} sessionId={sessionId} />}
    </li>
  );
}
