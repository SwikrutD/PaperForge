import { useCallback, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../controls/IconButton';
import styles from './Dialog.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Modal dialog with the behaviour Windows users expect: focus moves inside on
 * open, Tab is trapped, Escape closes, and focus returns to whatever opened it.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
}: DialogProps): ReactElement {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const focusables = useCallback((): HTMLElement[] => {
    const surface = surfaceRef.current;
    if (surface === null) return [];
    return [...surface.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null || element === document.activeElement,
    );
  }, []);

  useEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusables()[0] ?? surfaceRef.current;
    first?.focus();

    return () => {
      openerRef.current?.focus();
    };
  }, [focusables]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const elements = focusables();
    if (elements.length === 0) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (first === undefined || last === undefined) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className={styles.surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
        ref={surfaceRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className={styles.header}>
          <div>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            {description !== undefined && (
              <p className={styles.description} id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className={styles.body}>{children}</div>
        {footer !== undefined && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>
  );
}
