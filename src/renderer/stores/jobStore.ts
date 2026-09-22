import { create } from 'zustand';
import { isJobActive, type Job, type JobType } from '../types/jobs';
import { createId } from '../utils/ids';

export interface StartJobInput {
  type: JobType;
  title: string;
  totalItems?: number;
  cancellable?: boolean;
}

export interface JobProgressInput {
  currentItem?: string;
  completedItems?: number;
  totalItems?: number;
}

export interface JobStore {
  jobs: Job[];
  /** Registered by whoever owns the work, so Cancel can actually stop it. */
  cancelHandlers: Record<string, () => void>;
  start: (input: StartJobInput, onCancel?: () => void) => string;
  progress: (id: string, update: JobProgressInput) => void;
  succeed: (id: string, resultPath?: string) => void;
  fail: (id: string, error: string) => void;
  cancel: (id: string) => void;
  dismiss: (id: string) => void;
  dismissFinished: () => void;
}

function patchJob(jobs: Job[], id: string, patch: Partial<Job>): Job[] {
  return jobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
}

/**
 * The single place long operations report progress (CLAUDE.md section 36).
 * Heavy work itself runs in workers, utility processes or native sidecars; this
 * store only tracks state so the UI never blocks.
 */
export const useJobStore = create<JobStore>((set, get) => ({
  jobs: [],
  cancelHandlers: {},

  start: (input, onCancel) => {
    const job: Job = {
      id: createId('job'),
      type: input.type,
      title: input.title,
      state: 'running',
      currentItem: undefined,
      completedItems: 0,
      totalItems: input.totalItems,
      cancellable: input.cancellable ?? onCancel !== undefined,
      startedAt: Date.now(),
      finishedAt: undefined,
      error: undefined,
      resultPath: undefined,
    };
    set((state) => ({
      jobs: [...state.jobs, job],
      cancelHandlers:
        onCancel === undefined
          ? state.cancelHandlers
          : { ...state.cancelHandlers, [job.id]: onCancel },
    }));
    return job.id;
  },

  progress: (id, update) =>
    set((state) => ({
      jobs: patchJob(state.jobs, id, {
        ...(update.currentItem === undefined ? {} : { currentItem: update.currentItem }),
        ...(update.completedItems === undefined ? {} : { completedItems: update.completedItems }),
        ...(update.totalItems === undefined ? {} : { totalItems: update.totalItems }),
      }),
    })),

  succeed: (id, resultPath) =>
    set((state) => ({
      jobs: patchJob(state.jobs, id, {
        state: 'succeeded',
        finishedAt: Date.now(),
        resultPath,
      }),
    })),

  fail: (id, error) =>
    set((state) => ({
      jobs: patchJob(state.jobs, id, { state: 'failed', finishedAt: Date.now(), error }),
    })),

  cancel: (id) => {
    const job = get().jobs.find((candidate) => candidate.id === id);
    if (job === undefined || !isJobActive(job) || !job.cancellable) return;
    get().cancelHandlers[id]?.();
    set((state) => ({
      jobs: patchJob(state.jobs, id, { state: 'cancelled', finishedAt: Date.now() }),
    }));
  },

  dismiss: (id) =>
    set((state) => ({
      jobs: state.jobs.filter((job) => job.id !== id || isJobActive(job)),
    })),

  dismissFinished: () => set((state) => ({ jobs: state.jobs.filter(isJobActive) })),
}));
