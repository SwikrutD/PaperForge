import { useEffect, type ReactElement } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useUiStore } from '../../stores/uiStore';
import type { Toast } from '../../types/ui';
import { cx } from '../../utils/classNames';
import { IconButton } from '../controls/IconButton';
import styles from './ToastHost.module.css';

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertTriangle,
} as const;

function ToastRow({ toast }: { toast: Toast }): ReactElement {
  const dismiss = useUiStore((state) => state.dismissToast);
  const Icon = ICONS[toast.intent];

  useEffect(() => {
    if (toast.durationMs === undefined) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, dismiss]);

  return (
    <div
      className={cx(styles.toast, styles[toast.intent])}
      role={toast.intent === 'error' ? 'alert' : 'status'}
    >
      <Icon className={styles.icon} aria-hidden="true" strokeWidth={1.75} />
      <div className={styles.text}>
        <p className={styles.title}>{toast.title}</p>
        {toast.description !== undefined && (
          <p className={styles.description}>{toast.description}</p>
        )}
      </div>
      <IconButton icon={X} label="Dismiss" size="small" onClick={() => dismiss(toast.id)} />
    </div>
  );
}

/** Transient messages. Errors stay until dismissed; nothing here is decorative. */
export function ToastHost(): ReactElement | null {
  const toasts = useUiStore((state) => state.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className={styles.host} aria-live="polite">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
