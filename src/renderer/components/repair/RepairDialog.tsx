import { useEffect, useState, type ReactElement } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { AppError } from '@shared/errors/appError';
import type { RepairDiagnosis } from '@shared/schemas/repair';
import { invoke } from '../../services/ipcClient';
import { useDocumentStore } from '../../stores/documentStore';
import { useUiStore } from '../../stores/uiStore';
import { formatBytes } from '../../utils/format';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import admin from '../admin/admin.module.css';
import form from '../overlays/dialogForm.module.css';
import styles from './repair.module.css';

type Verdict = 'sound' | 'warnings' | 'damaged';

/** One sentence about the file, from what both engines made of it. */
function verdictOf(diagnosis: RepairDiagnosis): Verdict {
  if (diagnosis.qpdf.verdict === 'unreadable') return 'damaged';
  if (!diagnosis.engine.readable && !diagnosis.encrypted) return 'damaged';
  if (diagnosis.qpdf.verdict === 'warnings') return 'warnings';
  if (diagnosis.index !== null && !diagnosis.index.ok) return 'warnings';
  return 'sound';
}

const VERDICTS: Record<Verdict, { title: string; text: string; icon: typeof CheckCircle2 }> = {
  sound: {
    title: 'No structural problems found',
    text: 'The document reads cleanly. A repaired copy would be the same document written out afresh.',
    icon: CheckCircle2,
  },
  warnings: {
    title: 'The document has structural problems that can be worked around',
    text: 'It can be read, but parts of it are not where the file says they are. A repaired copy is written with those parts put right.',
    icon: AlertTriangle,
  },
  damaged: {
    title: 'The document is damaged',
    text: 'Part of it could not be read. A repaired copy keeps whatever can still be recovered; some pages or content may be missing from it.',
    icon: XCircle,
  },
};

/**
 * Check and Repair: what qpdf and PaperForge's own engine make of the file,
 * and a repaired copy written beside it. The file that was opened is never
 * replaced (CLAUDE.md section 27).
 */
export function RepairDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore((state) => {
    const active = state.activeId;
    return state.tabs.find((candidate) => candidate.session.id === active) ?? null;
  });
  const openPaths = useDocumentStore((state) => state.openPaths);
  const showToast = useUiStore((state) => state.showToast);
  const sessionId = tab?.session.id ?? null;
  const revision = tab?.edit.revision ?? 0;

  // A result belongs to the revision it was read from; another revision
  // shows "checking" until its own arrives.
  const key = `${sessionId ?? ''}:${String(revision)}`;
  const [result, setResult] = useState<{
    key: string;
    diagnosis: RepairDiagnosis | null;
    problem: string | null;
  } | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (sessionId === null) return;
    let current = true;
    invoke('repair:diagnose', { sessionId })
      .then((diagnosis) => {
        if (current) setResult({ key, diagnosis, problem: null });
      })
      .catch((error: unknown) => {
        if (current) {
          setResult({ key, diagnosis: null, problem: AppError.serialize(error).message });
        }
      });
    return () => {
      current = false;
    };
  }, [sessionId, key]);

  const diagnosis = result?.key === key ? result.diagnosis : null;
  const problem = result?.key === key ? result.problem : null;

  const save = async (): Promise<void> => {
    if (sessionId === null) return;
    setWorking(true);
    try {
      const outcome = await invoke('repair:save', { sessionId });
      if (outcome.canceled || outcome.path === null) return;
      onClose();
      showToast({
        title: `A repaired copy of ${String(outcome.pageCount)} ${
          outcome.pageCount === 1 ? 'page' : 'pages'
        } was written.`,
        description:
          outcome.method === 'qpdf'
            ? `Rebuilt by qpdf. ${outcome.path}`
            : `Rewritten by PaperForge, object by object. ${outcome.path}`,
        intent: 'success',
      });
      await openPaths([outcome.path]);
    } catch (error) {
      const serialized = AppError.serialize(error);
      showToast({ title: serialized.message, description: serialized.details, intent: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const verdict = diagnosis === null ? null : VERDICTS[verdictOf(diagnosis)];
  const Icon = verdict?.icon ?? CheckCircle2;

  return (
    <Dialog
      title="Check and Repair"
      description="How the document is put together, and a repaired copy if it needs one."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button
            appearance="primary"
            disabled={diagnosis === null || !diagnosis.canRepair || working}
            onClick={() => void save()}
          >
            {working ? 'Repairing…' : 'Save a repaired copy…'}
          </Button>
        </>
      }
    >
      <div className={form.form}>
        {problem !== null ? (
          <p className={form.problem}>{problem}</p>
        ) : diagnosis === null || verdict === null ? (
          <p className={form.summary}>Checking the document…</p>
        ) : (
          <>
            <div className={admin.securityState} data-repair-verdict={verdictOf(diagnosis)}>
              <Icon className={admin.securityIcon} aria-hidden="true" strokeWidth={1.8} />
              <div>
                <p className={admin.securityTitle}>{verdict.title}</p>
                <p className={admin.securityText}>{verdict.text}</p>
              </div>
            </div>

            <dl className={admin.facts}>
              <div className={admin.fact}>
                <dt className={admin.factTerm}>qpdf</dt>
                <dd className={admin.factValue}>{describeQpdf(diagnosis)}</dd>
              </div>
              <div className={admin.fact}>
                <dt className={admin.factTerm}>PaperForge</dt>
                <dd className={admin.factValue}>
                  {diagnosis.engine.readable
                    ? `Reads all ${String(diagnosis.engine.pageCount)} pages.`
                    : `Cannot read it: ${diagnosis.engine.problem ?? 'no reason given'}`}
                </dd>
              </div>
              <div className={admin.fact}>
                <dt className={admin.factTerm}>Index of objects</dt>
                <dd className={admin.factValue}>
                  {diagnosis.index === null
                    ? 'Not checked: the file is very large.'
                    : diagnosis.index.ok
                      ? 'Every object is where the file says it is.'
                      : diagnosis.index.problems.join(' ')}
                </dd>
              </div>
              <div className={admin.fact}>
                <dt className={admin.factTerm}>Size</dt>
                <dd className={admin.factValue}>{formatBytes(diagnosis.sizeBytes)}</dd>
              </div>
            </dl>

            {diagnosis.qpdf.messages.length > 0 && (
              <details className={styles.details}>
                <summary>{`What qpdf reported (${String(diagnosis.qpdf.messages.length)}${
                  diagnosis.qpdf.truncated ? '+' : ''
                })`}</summary>
                <ul className={styles.messages} aria-label="qpdf messages">
                  {diagnosis.qpdf.messages.map((message, index) => (
                    <li key={index}>{message}</li>
                  ))}
                </ul>
              </details>
            )}

            <p className={admin.caveat}>
              {diagnosis.qpdf.available
                ? 'The copy is written by qpdf, which rebuilds the file’s index of its own contents; PaperForge’s engine is used if qpdf cannot. '
                : 'qpdf is not installed, so the copy is written by PaperForge’s own engine, which reads the file object by object. Installing qpdf gives a second, stronger repair. '}
              The file you opened is left exactly as it is.
            </p>
            {diagnosis.encrypted && (
              <p className={admin.caveat}>
                This document is encrypted. qpdf can repair it with its security kept only when no
                password is needed to open it.
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function describeQpdf(diagnosis: RepairDiagnosis): string {
  const { qpdf } = diagnosis;
  if (!qpdf.available) return qpdf.messages[0] ?? 'Not installed.';
  const version = qpdf.version === null ? '' : ` (${qpdf.version})`;
  switch (qpdf.verdict) {
    case 'clean':
      return `Found no errors${version}.`;
    case 'warnings':
      return `Read it with warnings${version}.`;
    case 'unreadable':
      return `Could not read it${version}.`;
    default:
      return `Could not check it${version}.`;
  }
}
