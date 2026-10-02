import { describe, expect, it } from 'vitest';
import {
  finishedWorthNotifying,
  taskbarProgressFor,
} from '../../../src/renderer/app/useDesktopIntegration';
import type { Job } from '../../../src/renderer/types/jobs';

const job = (patch: Partial<Job>): Job => ({
  id: 'job-1',
  type: 'ocr',
  title: 'Recognising text',
  state: 'running',
  currentItem: undefined,
  completedItems: 0,
  totalItems: 10,
  cancellable: true,
  startedAt: 1_000,
  finishedAt: undefined,
  error: undefined,
  resultPath: undefined,
  ...patch,
});

describe('taskbar progress', () => {
  it('is clear with nothing running', () => {
    expect(taskbarProgressFor([])).toEqual({ state: 'none', value: 0 });
    expect(taskbarProgressFor([job({ state: 'succeeded' })]).state).toBe('none');
  });

  it('adds up the jobs in flight', () => {
    expect(
      taskbarProgressFor([
        job({ id: 'a', completedItems: 3, totalItems: 10 }),
        job({ id: 'b', completedItems: 7, totalItems: 10 }),
      ]),
    ).toEqual({ state: 'normal', value: 0.5 });
  });

  it('pulses when a job cannot say how far along it is', () => {
    expect(taskbarProgressFor([job({ totalItems: undefined })]).state).toBe('indeterminate');
  });
});

describe('notifications', () => {
  it('tells of long work that has just finished, either way', () => {
    const before = [job({ id: 'a' }), job({ id: 'b' })];
    const after = [
      job({ id: 'a', state: 'succeeded', finishedAt: 9_000 }),
      job({ id: 'b', state: 'failed', finishedAt: 7_000, error: 'No Tesseract' }),
    ];
    expect(finishedWorthNotifying(before, after).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('stays quiet about quick work, cancelled work and work already reported', () => {
    const quick = [job({ state: 'succeeded', finishedAt: 2_000 })];
    expect(finishedWorthNotifying([job({})], quick)).toEqual([]);

    const cancelled = [job({ state: 'cancelled', finishedAt: 60_000 })];
    expect(finishedWorthNotifying([job({})], cancelled)).toEqual([]);

    const done = [job({ state: 'succeeded', finishedAt: 60_000 })];
    expect(finishedWorthNotifying(done, done)).toEqual([]);
  });
});
