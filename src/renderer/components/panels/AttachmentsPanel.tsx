import type { ReactElement } from 'react';
import { Paperclip, ShieldAlert } from 'lucide-react';
import type { PdfAttachment } from '@pdf/render/types';
import { formatBytes } from '../../utils/format';
import styles from './AttachmentsPanel.module.css';

const RISKY_EXTENSIONS = new Set([
  'exe',
  'com',
  'bat',
  'cmd',
  'msi',
  'ps1',
  'vbs',
  'js',
  'jse',
  'wsf',
  'scr',
  'lnk',
  'reg',
  'jar',
]);

/**
 * What is known about the file besides its name. The size is only stated when
 * the document reveals one, rather than guessed at.
 */
function meta(attachment: PdfAttachment): string {
  const parts: string[] = [];
  if (attachment.sizeBytes !== null) parts.push(formatBytes(attachment.sizeBytes));
  if (attachment.description !== null) parts.push(attachment.description);
  return parts.join(' · ');
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index < 0 ? '' : fileName.slice(index + 1).toLowerCase();
}

/**
 * Files carried inside the document. This is a listing only: PaperForge never
 * opens an embedded file, and saving one arrives with the attachment tools.
 */
export function AttachmentsPanel({
  attachments,
}: {
  attachments: readonly PdfAttachment[];
}): ReactElement {
  return (
    <div className={styles.panel}>
      <ul className={styles.list}>
        {attachments.map((attachment) => {
          const risky = RISKY_EXTENSIONS.has(extensionOf(attachment.fileName));
          return (
            <li key={attachment.id} className={styles.item}>
              <Paperclip className={styles.icon} aria-hidden="true" strokeWidth={1.6} />
              <span className={styles.text}>
                <span className={styles.name}>{attachment.fileName}</span>
                {meta(attachment) !== '' && <span className={styles.meta}>{meta(attachment)}</span>}
              </span>
              {risky && (
                <span className={styles.warning} title="This kind of file can run code.">
                  <ShieldAlert
                    className={styles.warningIcon}
                    aria-hidden="true"
                    strokeWidth={1.8}
                  />
                  <span className="pf-visually-hidden">This kind of file can run code.</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className={styles.note}>
        PaperForge lists embedded files but never opens them. Saving an attachment arrives with the
        attachment tools.
      </p>
    </div>
  );
}
