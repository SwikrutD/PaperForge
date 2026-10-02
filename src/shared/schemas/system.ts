import { z } from 'zod';

/**
 * How PaperForge fits into Windows: being offered for PDF files, progress on
 * the taskbar button, and a notification when long work finishes while the
 * reader is elsewhere.
 */

export const fileAssociationStatusSchema = z.strictObject({
  /**
   * False when this copy cannot be offered for PDFs — a development build,
   * or not Windows — with the reason in `problem`.
   */
  supported: z.boolean(),
  /** PaperForge is in the Open With list for PDF files. */
  openWith: z.boolean(),
  /** PDF files open in PaperForge when double-clicked. */
  isDefault: z.boolean(),
  problem: z.string().max(500).nullable(),
});
export type FileAssociationStatus = z.infer<typeof fileAssociationStatusSchema>;

/** What the taskbar button shows. */
export const taskbarProgressSchema = z.strictObject({
  state: z.enum(['none', 'normal', 'indeterminate', 'error']),
  /** From 0 to 1; read only in the normal state. */
  value: z.number().min(0).max(1),
});
export type TaskbarProgress = z.infer<typeof taskbarProgressSchema>;

export const notificationRequestSchema = z.strictObject({
  title: z.string().min(1).max(200),
  body: z.string().max(500),
});
export type NotificationRequest = z.infer<typeof notificationRequestSchema>;

/** Sent to a window when files arrive from Explorer or a jump list. */
export const launchPathsWaitingSchema = z.strictObject({ count: z.number().int().min(1) });
