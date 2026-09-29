import type { ReactElement } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import type {
  DocumentPermissions,
  ModifyPermission,
  PrintPermission,
  SecuritySummary,
} from '@shared/schemas/protect';
import styles from './admin.module.css';

const PRINT_LABELS: Record<PrintPermission, string> = {
  none: 'Not allowed',
  low: 'Low resolution only',
  full: 'Allowed',
};

const MODIFY_LABELS: Record<ModifyPermission, string> = {
  none: 'Not allowed',
  assembly: 'Inserting, rotating and deleting pages',
  form: 'Filling in form fields',
  annotate: 'Commenting and filling in form fields',
  all: 'Allowed',
};

function yesNo(value: boolean): string {
  return value ? 'Allowed' : 'Not allowed';
}

function permissionRows(permissions: DocumentPermissions): Array<[string, string]> {
  return [
    ['Printing', PRINT_LABELS[permissions.print]],
    ['Changing the document', MODIFY_LABELS[permissions.modify]],
    ['Copying text and graphics', yesNo(permissions.extract)],
    ['Reading by assistive software', yesNo(permissions.extractForAccessibility)],
    ['Commenting', yesNo(permissions.annotate)],
    ['Filling in form fields', yesNo(permissions.fillForms)],
    ['Assembling pages', yesNo(permissions.assemble)],
  ];
}

/**
 * What a document's own encryption dictionary says.
 *
 * PDF permissions are a request a conforming reader honours, not a lock. The
 * wording here says what the document asks for and does not suggest anything
 * enforces it (CLAUDE.md section 20).
 */
export function SecuritySummaryView({ security }: { security: SecuritySummary }): ReactElement {
  if (!security.encrypted) {
    return (
      <div className={styles.securityState}>
        <LockOpen className={styles.securityIcon} aria-hidden="true" strokeWidth={1.6} />
        <div>
          <p className={styles.securityTitle}>No security</p>
          <p className={styles.securityText}>
            Anyone can open this document, and nothing in it restricts printing, copying or
            changing.
          </p>
        </div>
      </div>
    );
  }

  const facts: Array<[string, string]> = [
    ['Method', security.algorithm ?? 'Not stated'],
    ...(security.keyLengthBits === null
      ? []
      : ([['Key length', `${String(security.keyLengthBits)}-bit`]] as Array<[string, string]>)),
    [
      'Password to open',
      security.openPasswordRequired === null
        ? 'Could not be determined'
        : security.openPasswordRequired
          ? 'Required'
          : 'Not required',
    ],
    [
      'Metadata',
      security.encryptMetadata === false ? 'Left readable' : 'Encrypted with the document',
    ],
    ...(security.handler === null || security.handler === 'Standard'
      ? []
      : ([['Handler', security.handler]] as Array<[string, string]>)),
  ];

  return (
    <div className={styles.securityBlock}>
      <div className={styles.securityState}>
        <Lock className={styles.securityIcon} aria-hidden="true" strokeWidth={1.6} />
        <div>
          <p className={styles.securityTitle}>
            {security.openPasswordRequired === true
              ? 'Password protected'
              : 'Protected against changes'}
          </p>
          <p className={styles.securityText}>
            {security.openPasswordRequired === true
              ? 'A password is needed to open this document.'
              : 'This document opens without a password, and asks readers to respect the restrictions below.'}
          </p>
        </div>
      </div>

      <dl className={styles.facts}>
        {facts.map(([label, value]) => (
          <div key={label} className={styles.fact}>
            <dt className={styles.factTerm}>{label}</dt>
            <dd className={styles.factValue}>{value}</dd>
          </div>
        ))}
      </dl>

      {security.permissions !== null && (
        <>
          <h4 className={styles.subheading}>What the document permits</h4>
          <dl className={styles.facts}>
            {permissionRows(security.permissions).map(([label, value]) => (
              <div key={label} className={styles.fact}>
                <dt className={styles.factTerm}>{label}</dt>
                <dd className={styles.factValue}>{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <p className={styles.caveat}>
        These are cooperative controls. A reader that follows the PDF specification honours them;
        PaperForge cannot promise that every program will.
      </p>
    </div>
  );
}
