import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import {
  OPTIMIZE_PRESETS,
  type OptimizeAnalysis,
  type OptimizeOutcome,
  type OptimizePreset,
  type OptimizeSettings,
} from '@shared/schemas/optimize';
import { invoke } from '../services/ipcClient';
import { formatBytes } from '../utils/format';
import { useDocumentStore } from './documentStore';
import { useJobStore } from './jobStore';
import { useUiStore } from './uiStore';

/**
 * Optimize PDF: what the document holds, the settings chosen, and what the
 * last run did. The work itself happens in the main process; this is the
 * window's side of it.
 */

interface OptimizeState {
  analysis: OptimizeAnalysis | null;
  analysisFor: { sessionId: string; revision: number } | null;
  /** The preset the settings came from, or null once one has been changed. */
  preset: OptimizePreset | null;
  settings: OptimizeSettings;
  running: boolean;
  outcome: OptimizeOutcome | null;

  analyze: (sessionId: string, revision: number) => Promise<void>;
  choosePreset: (preset: OptimizePreset) => void;
  setSettings: (patch: Partial<OptimizeSettings>) => void;
  run: (sessionId: string) => Promise<OptimizeOutcome | null>;
  reset: () => void;
}

function report(error: unknown): void {
  const serialized = AppError.serialize(error);
  useUiStore.getState().showToast({
    title: serialized.message,
    description: serialized.details,
    intent: 'error',
  });
}

/** "4.2 MB → 1.1 MB (74% smaller)". */
export function describeSaving(outcome: OptimizeOutcome): string {
  const before = formatBytes(outcome.beforeBytes);
  const after = formatBytes(outcome.afterBytes);
  if (outcome.beforeBytes === 0) return `${before} → ${after}`;
  const change = Math.round((1 - outcome.afterBytes / outcome.beforeBytes) * 100);
  return change > 0 ? `${before} → ${after} (${String(change)}% smaller)` : `${before} → ${after}`;
}

export const useOptimizeStore = create<OptimizeState>((set, get) => ({
  analysis: null,
  analysisFor: null,
  preset: 'balanced',
  settings: OPTIMIZE_PRESETS.balanced,
  running: false,
  outcome: null,

  analyze: async (sessionId, revision) => {
    const loaded = get().analysisFor;
    if (loaded?.sessionId === sessionId && loaded.revision === revision) return;
    set({ analysis: null, analysisFor: { sessionId, revision } });
    try {
      const analysis = await invoke('optimize:analyze', { sessionId });
      if (get().analysisFor?.revision === revision) set({ analysis });
    } catch (error) {
      report(error);
    }
  },

  choosePreset: (preset) => set({ preset, settings: OPTIMIZE_PRESETS[preset] }),

  setSettings: (patch) =>
    set((state) => ({ preset: null, settings: { ...state.settings, ...patch } })),

  run: async (sessionId) => {
    const tab = useDocumentStore.getState().tabs.find((entry) => entry.session.id === sessionId);
    const jobs = useJobStore.getState();
    const job = jobs.start({
      type: 'optimize',
      title: `Optimizing ${tab?.session.file.displayName ?? 'the document'}`,
    });
    set({ running: true, outcome: null });

    try {
      const outcome = await invoke('optimize:run', { sessionId, settings: get().settings });
      if (outcome.edit !== null) useDocumentStore.getState().receiveEdit(outcome.edit);
      useJobStore.getState().succeed(job);
      set({ outcome });
      return outcome;
    } catch (error) {
      useJobStore.getState().fail(job, AppError.serialize(error).message);
      report(error);
      return null;
    } finally {
      set({ running: false });
    }
  },

  reset: () => set({ outcome: null }),
}));
