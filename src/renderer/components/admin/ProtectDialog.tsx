import { useEffect, useState, type ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import type {
  KeyLength,
  ModifyPermission,
  PermissionChoices,
  PrintPermission,
} from '@shared/schemas/protect';
import { DEFAULT_PERMISSION_CHOICES } from '@shared/schemas/protect';
import { useAdminStore } from '../../stores/adminStore';
import { useDocumentStore } from '../../stores/documentStore';
import { useUiStore } from '../../stores/uiStore';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import { cx } from '../../utils/classNames';
import form from '../overlays/dialogForm.module.css';
import styles from './admin.module.css';
import { SecuritySummaryView } from './SecuritySummaryView';

const KEY_LENGTHS: Array<{ value: KeyLength; label: string }> = [
  { value: 256, label: 'AES 256-bit — best, needs Acrobat X or later' },
  { value: 128, label: 'AES 128-bit — widely readable' },
  { value: 40, label: 'RC4 40-bit — only for very old readers' },
];

const PRINT_OPTIONS: Array<{ value: PrintPermission; label: string }> = [
  { value: 'full', label: 'Allowed' },
  { value: 'low', label: 'Low resolution only' },
  { value: 'none', label: 'Not allowed' },
];

const MODIFY_OPTIONS: Array<{ value: ModifyPermission; label: string }> = [
  { value: 'all', label: 'Anything' },
  { value: 'annotate', label: 'Commenting and filling in form fields' },
  { value: 'form', label: 'Filling in form fields' },
  { value: 'assembly', label: 'Inserting, rotating and deleting pages' },
  { value: 'none', label: 'Nothing' },
];

type Mode = 'add' | 'remove';

/**
 * Protect PDF.
 *
 * Both operations write a new file: an encrypted document cannot be edited, so
 * swapping one in for the document the reader has open would take their work
 * away. The open document is left exactly as it is.
 *
 * This is document security, not a signature and not DRM. The wording says
 * what the PDF standard actually provides and nothing more.
 */
export function ProtectDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore((state) => {
    const active = state.activeId;
    return state.tabs.find((candidate) => candidate.session.id === active) ?? null;
  });
  const properties = useAdminStore((state) => state.properties);
  const loadProperties = useAdminStore((state) => state.loadProperties);
  const busy = useAdminStore((state) => state.busy);
  const showToast = useUiStore((state) => state.showToast);

  const sessionId = tab?.session.id ?? null;
  const revision = tab?.edit.revision ?? 0;
  const security = properties?.security ?? null;
  const alreadyEncrypted = security?.encrypted === true;

  // Null means "whichever fits this document": a protected one opens on
  // removing security, an unprotected one on adding it.
  const [chosenMode, setMode] = useState<Mode | null>(null);
  const [openPassword, setOpenPassword] = useState('');
  const [openPasswordAgain, setOpenPasswordAgain] = useState('');
  const [permissionsPassword, setPermissionsPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [keyLengthBits, setKeyLengthBits] = useState<KeyLength>(256);
  const [permissions, setPermissions] = useState<PermissionChoices>(DEFAULT_PERMISSION_CHOICES);
  const [encryptMetadata, setEncryptMetadata] = useState(true);

  useEffect(() => {
    if (sessionId === null) return;
    void loadProperties(sessionId, revision);
  }, [loadProperties, sessionId, revision]);

  const mode: Mode = chosenMode ?? (alreadyEncrypted ? 'remove' : 'add');

  const mismatch = openPassword !== '' && openPassword !== openPasswordAgain;
  const nothingToDo = mode === 'add' && openPassword === '' && permissionsPassword === '';

  const setPermission = <K extends keyof PermissionChoices>(
    key: K,
    value: PermissionChoices[K],
  ): void => {
    setPermissions((current) => ({ ...current, [key]: value }));
  };

  const run = async (): Promise<void> => {
    if (sessionId === null) return;

    const path =
      mode === 'add'
        ? await useAdminStore.getState().protect({
            openPassword,
            permissionsPassword,
            keyLengthBits,
            permissions,
            encryptMetadata,
          })
        : await useAdminStore.getState().unprotect(currentPassword);

    if (path === null) return;
    showToast({
      title: mode === 'add' ? 'Protected copy saved' : 'Unprotected copy saved',
      description: `${path}. The document you have open is unchanged.`,
      intent: 'success',
    });
    onClose();
  };

  return (
    <Dialog
      title="Protect PDF"
      description="Writes a new file. The document you have open keeps whatever security it already had."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            appearance="primary"
            disabled={busy || sessionId === null || mismatch || nothingToDo}
            onClick={() => void run()}
          >
            {mode === 'add' ? 'Save protected copy' : 'Save unprotected copy'}
          </Button>
        </>
      }
    >
      <div className={form.form}>
        {security !== null && <SecuritySummaryView security={security} />}

        <fieldset className={form.group}>
          <legend className={form.legend}>What to do</legend>
          <label className={form.choice}>
            <input
              type="radio"
              name="protect-mode"
              checked={mode === 'add'}
              onChange={() => setMode('add')}
            />
            <span className={form.choiceText}>
              Add password protection
              <span className={form.hint}>
                Encrypts the document and records what a reader may do with it.
              </span>
            </span>
          </label>
          <label className={form.choice}>
            <input
              type="radio"
              name="protect-mode"
              checked={mode === 'remove'}
              disabled={!alreadyEncrypted}
              onChange={() => setMode('remove')}
            />
            <span className={form.choiceText}>
              Remove security
              <span className={form.hint}>
                {alreadyEncrypted
                  ? 'Needs a password that opens the document.'
                  : 'This document has no security to remove.'}
              </span>
            </span>
          </label>
        </fieldset>

        {mode === 'remove' ? (
          <div className={form.row}>
            <label className={form.label} htmlFor="protect-current">
              Password
            </label>
            <input
              id="protect-current"
              type="password"
              autoComplete="off"
              className={cx(form.input, form.grow)}
              value={currentPassword}
              maxLength={200}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
        ) : (
          <>
            <fieldset className={form.group}>
              <legend className={form.legend}>Passwords</legend>
              <div className={form.row}>
                <label className={form.label} htmlFor="protect-open">
                  To open
                </label>
                <input
                  id="protect-open"
                  type="password"
                  autoComplete="new-password"
                  className={cx(form.input, form.grow)}
                  value={openPassword}
                  maxLength={200}
                  onChange={(event) => setOpenPassword(event.target.value)}
                />
              </div>
              <div className={form.row}>
                <label className={form.label} htmlFor="protect-open-again">
                  Again
                </label>
                <input
                  id="protect-open-again"
                  type="password"
                  autoComplete="new-password"
                  className={cx(form.input, form.grow)}
                  value={openPasswordAgain}
                  maxLength={200}
                  onChange={(event) => setOpenPasswordAgain(event.target.value)}
                />
              </div>
              <div className={form.row}>
                <label className={form.label} htmlFor="protect-permissions">
                  To change
                </label>
                <input
                  id="protect-permissions"
                  type="password"
                  autoComplete="new-password"
                  className={cx(form.input, form.grow)}
                  value={permissionsPassword}
                  maxLength={200}
                  onChange={(event) => setPermissionsPassword(event.target.value)}
                />
              </div>
              {mismatch && <p className={form.problem}>The two open passwords do not match.</p>}
              <p className={form.hint}>
                Leave &ldquo;to open&rdquo; empty to let anyone open the document while the
                restrictions still apply.
              </p>
            </fieldset>

            {permissionsPassword === '' && (
              <p className={styles.warningBar}>
                <AlertTriangle
                  className={styles.warningIcon}
                  aria-hidden="true"
                  strokeWidth={1.8}
                />
                <span>
                  Without a password to change it, anyone can lift these restrictions. Set one if
                  the restrictions are the point.
                </span>
              </p>
            )}

            <fieldset className={form.group}>
              <legend className={form.legend}>What readers may do</legend>
              <div className={form.row}>
                <label className={form.label} htmlFor="protect-print">
                  Printing
                </label>
                <select
                  id="protect-print"
                  className={form.select}
                  value={permissions.print}
                  onChange={(event) =>
                    setPermission('print', event.target.value as PrintPermission)
                  }
                >
                  {PRINT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={form.row}>
                <label className={form.label} htmlFor="protect-modify">
                  Changing
                </label>
                <select
                  id="protect-modify"
                  className={form.select}
                  value={permissions.modify}
                  onChange={(event) =>
                    setPermission('modify', event.target.value as ModifyPermission)
                  }
                >
                  {MODIFY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className={form.choice}>
                <input
                  type="checkbox"
                  checked={permissions.extract}
                  onChange={(event) => setPermission('extract', event.target.checked)}
                />
                <span className={form.choiceText}>Copying text and graphics</span>
              </label>
              <label className={form.choice}>
                <input
                  type="checkbox"
                  checked={permissions.extractForAccessibility}
                  disabled={keyLengthBits === 40}
                  onChange={(event) =>
                    setPermission('extractForAccessibility', event.target.checked)
                  }
                />
                <span className={form.choiceText}>
                  Reading by assistive software
                  <span className={form.hint}>
                    {keyLengthBits === 40
                      ? '40-bit encryption has no separate bit for this; it follows copying.'
                      : 'Turning this off stops screen readers as well. Leave it on unless you have a reason.'}
                  </span>
                </span>
              </label>
            </fieldset>

            <fieldset className={form.group}>
              <legend className={form.legend}>Encryption</legend>
              <div className={form.row}>
                <label className={form.label} htmlFor="protect-bits">
                  Method
                </label>
                <select
                  id="protect-bits"
                  className={cx(form.select, form.grow)}
                  value={String(keyLengthBits)}
                  onChange={(event) =>
                    setKeyLengthBits(Number.parseInt(event.target.value, 10) as KeyLength)
                  }
                >
                  {KEY_LENGTHS.map((option) => (
                    <option key={option.value} value={String(option.value)}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className={form.choice}>
                <input
                  type="checkbox"
                  checked={!encryptMetadata}
                  disabled={keyLengthBits === 40}
                  onChange={(event) => setEncryptMetadata(!event.target.checked)}
                />
                <span className={form.choiceText}>
                  Leave the metadata readable
                  <span className={form.hint}>
                    Lets search tools index the title and author without the password. The pages
                    stay encrypted.
                  </span>
                </span>
              </label>
            </fieldset>
          </>
        )}

        <p className={form.summary}>
          PaperForge uses the local qpdf program for this. Passwords are handed to it directly and
          are never written to a log, a settings file or the recovery journal — and PaperForge
          cannot recover one for you if it is lost.
        </p>
      </div>
    </Dialog>
  );
}
