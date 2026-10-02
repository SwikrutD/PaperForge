import { useEffect } from 'react';
import type { TaskbarProgress } from '@shared/schemas/system';
import { invoke } from '../services/ipcClient';
import { useJobStore } from '../stores/jobStore';
import { isJobActive, type Job } from '../types/jobs';

/** Work shorter than this finishes before anyone has looked away. */
const NOTIFY_AFTER_MS = 5_000;

/** What the taskbar button should show for the jobs in flight. */
export function taskbarProgressFor(jobs: readonly Job[]): TaskbarProgress {
  const active = jobs.filter(isJobActive);
  if (active.length === 0) return { state: 'none', value: 0 };
  if (active.some((job) => job.totalItems === undefined || job.totalItems <= 0)) {
    return { state: 'indeterminate', value: 0 };
  }
  const total = active.reduce((sum, job) => sum + (job.totalItems ?? 0), 0);
  const done = active.reduce(
    (sum, job) => sum + Math.min(job.completedItems, job.totalItems ?? 0),
    0,
  );
  return { state: 'normal', value: Math.round((done / total) * 100) / 100 };
}

/** Jobs that have just finished, worth telling a reader who looked away about. */
export function finishedWorthNotifying(previous: readonly Job[], next: readonly Job[]): Job[] {
  return next.filter((job) => {
    if (job.state !== 'succeeded' && job.state !== 'failed') return false;
    const before = previous.find((candidate) => candidate.id === job.id);
    if (before === undefined || !isJobActive(before)) return false;
    return (job.finishedAt ?? 0) - job.startedAt >= NOTIFY_AFTER_MS;
  });
}

/**
 * Long work shows on the taskbar button, and a notification says when it
 * finishes. The main process shows the notification only while this window
 * is not in front, and only if the reader has not turned them off.
 */
export function useDesktopIntegration(): void {
  useEffect(() => {
    let shown = '';
    const show = (progress: TaskbarProgress): void => {
      const key = `${progress.state}:${String(progress.value)}`;
      if (key === shown) return;
      shown = key;
      void invoke('window:setProgress', progress).catch(() => undefined);
    };

    show(taskbarProgressFor(useJobStore.getState().jobs));
    return useJobStore.subscribe((state, previous) => {
      if (state.jobs === previous.jobs) return;
      show(taskbarProgressFor(state.jobs));
      for (const job of finishedWorthNotifying(previous.jobs, state.jobs)) {
        void invoke('window:notify', {
          title: job.title,
          body:
            job.state === 'succeeded'
              ? 'Finished.'
              : `Did not finish${job.error === undefined ? '.' : `: ${job.error}`}`.slice(0, 500),
        }).catch(() => undefined);
      }
    });
  }, []);
}
