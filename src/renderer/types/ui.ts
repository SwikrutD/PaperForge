/** Modal dialogs the shell can show. Each one has a real implementation. */
export type DialogId = 'settings' | 'about';

export type ToastIntent = 'info' | 'success' | 'warning' | 'error';

export interface ToastInput {
  title: string;
  description?: string;
  intent?: ToastIntent;
  /** Milliseconds before auto-dismiss. Errors stay until dismissed. */
  durationMs?: number;
}

export interface Toast {
  id: string;
  title: string;
  description: string | undefined;
  intent: ToastIntent;
  durationMs: number | undefined;
}

/** Major focus regions cycled with F6, in order. */
export const FOCUS_REGIONS = [
  'commandBar',
  'leftRail',
  'leftPanel',
  'workspace',
  'rightPanel',
  'statusBar',
] as const;

export type FocusRegion = (typeof FOCUS_REGIONS)[number];
