/**
 * Background job model from CLAUDE.md section 36. Long operations (OCR,
 * export, combine, optimize, compare, large saves) register here so the UI
 * never blocks and progress is always visible in one place.
 */
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type JobType =
  'ocr' | 'export' | 'combine' | 'optimize' | 'compare' | 'redact' | 'convert' | 'save';

export interface Job {
  id: string;
  type: JobType;
  title: string;
  state: JobState;
  /** What the job is working on right now, e.g. "Page 4 of 120". */
  currentItem: string | undefined;
  completedItems: number;
  totalItems: number | undefined;
  cancellable: boolean;
  startedAt: number;
  finishedAt: number | undefined;
  error: string | undefined;
  resultPath: string | undefined;
}

/** Percentage when the total is known, otherwise null for an indeterminate bar. */
export function jobProgress(job: Job): number | null {
  if (job.totalItems === undefined || job.totalItems <= 0) return null;
  return Math.min(100, Math.round((job.completedItems / job.totalItems) * 100));
}

export function isJobActive(job: Job): boolean {
  return job.state === 'queued' || job.state === 'running';
}
