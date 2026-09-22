import { useState, type ReactElement } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import styles from './PasswordPrompt.module.css';

interface PasswordPromptProps {
  fileName: string;
  retry: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/**
 * Asks for the password of an encrypted document.
 *
 * The value goes straight to the PDF engine in this process: it is never sent
 * over IPC, never stored, and never written to the log.
 */
export function PasswordPrompt({
  fileName,
  retry,
  onSubmit,
  onCancel,
}: PasswordPromptProps): ReactElement {
  const [password, setPassword] = useState('');

  return (
    <Dialog
      title="Password required"
      description={fileName}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            appearance="primary"
            disabled={password === ''}
            onClick={() => onSubmit(password)}
          >
            Open
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (password !== '') onSubmit(password);
        }}
      >
        <p className={styles.intro}>
          <Lock className={styles.icon} aria-hidden="true" strokeWidth={1.75} />
          <span>
            This document is encrypted. Enter the password that opens it; PaperForge does not store
            it.
          </span>
        </p>
        <label className={styles.label} htmlFor="pf-password">
          Password
        </label>
        <input
          id="pf-password"
          className={styles.input}
          type="password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {retry && (
          <p className={styles.error} role="alert">
            That password did not work. Try again.
          </p>
        )}
      </form>
    </Dialog>
  );
}
