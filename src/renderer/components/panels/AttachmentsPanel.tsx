import { useEffect, useState, type ReactElement } from 'react';
import { Download, Paperclip, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import type { EmbeddedFile } from '@shared/schemas/attachment';
import { useAdminStore } from '../../stores/adminStore';
import { useUiStore } from '../../stores/uiStore';
import { formatBytes } from '../../utils/format';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import styles from './AttachmentsPanel.module.css';

/**
 * What is known about the file besides its name. The size is only stated when
 * the document reveals one, rather than guessed at.
 */
function meta(attachment: EmbeddedFile): string {
  const parts: string[] = [];
  if (attachment.sizeBytes !== null) parts.push(formatBytes(attachment.sizeBytes));
  if (attachment.mimeType !== null) parts.push(attachment.mimeType);
  if (attachment.description !== null) parts.push(attachment.description);
  return parts.join(' · ');
}

/**
 * Files carried inside the document.
 *
 * PaperForge never opens an embedded file and never runs one. Saving writes
 * the bytes where the reader chose and stops there; a file whose name says
 * Windows could run it is called out first, and confirmed before it is
 * written (CLAUDE.md section 25).
 */
export function AttachmentsPanel({
  sessionId,
  revision,
  readOnly,
}: {
  sessionId: string;
  revision: number;
  /** True when the document cannot be changed, so only saving is offered. */
  readOnly: boolean;
}): ReactElement {
  const attachments = useAdminStore((state) => state.attachments);
  const loadedFor = useAdminStore((state) => state.attachmentsFor);
  const busy = useAdminStore((state) => state.busy);
  const load = useAdminStore((state) => state.loadAttachments);
  const requestConfirmation = useUiStore((state) => state.requestConfirmation);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    void load(sessionId, revision);
  }, [load, sessionId, revision]);

  const ready = loadedFor?.sessionId === sessionId && loadedFor.revision === revision;
  const list = ready ? attachments : [];

  const save = (attachment: EmbeddedFile): void => {
    if (!attachment.risky) {
      void useAdminStore.getState().saveAttachment(attachment.id);
      return;
    }

    requestConfirmation({
      title: 'This file can run code',
      message: `${attachment.fileName} is the kind of file Windows will execute. PaperForge will write it to disk and will not open it. Only save it if you know where this document came from.`,
      confirmLabel: 'Save anyway',
      danger: true,
      onConfirm: () => {
        void useAdminStore.getState().saveAttachment(attachment.id);
      },
    });
  };

  const remove = (attachment: EmbeddedFile): void => {
    setPending(attachment.id);
    requestConfirmation({
      title: 'Remove this attachment?',
      message: `${attachment.fileName} will be taken out of the document. Undo puts it back until you save.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => {
        void useAdminStore.getState().removeAttachments([attachment.id]);
        setPending(null);
      },
    });
  };

  return (
    <div className={styles.panel}>
      {!readOnly && (
        <div className={styles.actions}>
          <Button
            icon={Plus}
            disabled={busy}
            onClick={() => void useAdminStore.getState().attachFiles()}
          >
            Attach files
          </Button>
        </div>
      )}

      {list.length === 0 ? (
        <p className={styles.empty}>
          {ready
            ? 'This document carries no embedded files.'
            : 'Reading what this document carries…'}
        </p>
      ) : (
        <ul className={styles.list}>
          {list.map((attachment) => (
            <li
              key={attachment.id}
              className={styles.item}
              data-pending={attachment.id === pending}
            >
              <Paperclip className={styles.icon} aria-hidden="true" strokeWidth={1.6} />
              <span className={styles.text}>
                <span className={styles.name}>{attachment.fileName}</span>
                {meta(attachment) !== '' && <span className={styles.meta}>{meta(attachment)}</span>}
              </span>
              {attachment.risky && (
                <span className={styles.warning} title="This kind of file can run code.">
                  <ShieldAlert
                    className={styles.warningIcon}
                    aria-hidden="true"
                    strokeWidth={1.8}
                  />
                  <span className="pf-visually-hidden">This kind of file can run code.</span>
                </span>
              )}
              <span className={styles.itemActions}>
                <IconButton
                  icon={Download}
                  size="small"
                  label={`Save ${attachment.fileName}`}
                  disabled={busy}
                  onClick={() => save(attachment)}
                />
                {!readOnly && (
                  <IconButton
                    icon={Trash2}
                    size="small"
                    label={`Remove ${attachment.fileName}`}
                    disabled={busy}
                    onClick={() => remove(attachment)}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.note}>
        PaperForge lists embedded files and never opens one. Saving writes the bytes where you
        choose; nothing is run.
      </p>
    </div>
  );
}
