import { useEffect, type ReactElement } from 'react';
import type {
  OptimizeAnalysis,
  OptimizeOutcome,
  OptimizePreset,
  OptimizeSettings,
} from '@shared/schemas/optimize';
import { useDocumentStore } from '../../stores/documentStore';
import { describeSaving, useOptimizeStore } from '../../stores/optimizeStore';
import { formatBytes } from '../../utils/format';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import admin from '../admin/admin.module.css';
import form from '../overlays/dialogForm.module.css';
import styles from './optimize.module.css';

const PRESETS: Array<{ id: OptimizePreset; title: string; hint: string }> = [
  {
    id: 'quality',
    title: 'Low compression, high quality',
    hint: 'Pictures above 300 dpi are brought down to it; nothing is stored more lossily than it was.',
  },
  {
    id: 'balanced',
    title: 'Balanced',
    hint: 'Pictures at 150 dpi, photographs as JPEG at quality 80. Right for reading on screen and ordinary printing.',
  },
  {
    id: 'small',
    title: 'Small file',
    hint: 'Pictures at 96 dpi, JPEG at quality 60. Pictures may look soft when zoomed in or printed.',
  },
];

/**
 * Optimize PDF: presets for the usual cases, every setting for the rest, and
 * the measured result. The change is one undoable step until the document is
 * saved (CLAUDE.md section 27).
 */
export function OptimizeDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore((state) => {
    const active = state.activeId;
    return state.tabs.find((candidate) => candidate.session.id === active) ?? null;
  });
  const analysis = useOptimizeStore((state) => state.analysis);
  const preset = useOptimizeStore((state) => state.preset);
  const settings = useOptimizeStore((state) => state.settings);
  const running = useOptimizeStore((state) => state.running);
  const outcome = useOptimizeStore((state) => state.outcome);
  const store = useOptimizeStore.getState;

  const sessionId = tab?.session.id ?? null;
  const revision = tab?.edit.revision ?? 0;

  // A result belongs to the run that produced it; reopening starts afresh.
  useEffect(() => {
    store().reset();
  }, [store]);

  useEffect(() => {
    if (sessionId !== null && !useOptimizeStore.getState().running) {
      void useOptimizeStore.getState().analyze(sessionId, revision);
    }
  }, [sessionId, revision]);

  const qpdf = analysis?.qpdfAvailable ?? false;
  const set = (patch: Partial<OptimizeSettings>): void => store().setSettings(patch);

  return (
    <Dialog
      title="Optimize PDF"
      description="Make the document smaller. Nothing changes until you choose Optimize, and Undo takes it back until you save."
      onClose={onClose}
      footer={
        outcome !== null ? (
          <Button appearance="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              appearance="primary"
              disabled={sessionId === null || analysis === null || running}
              onClick={() => sessionId !== null && void store().run(sessionId)}
            >
              {running ? 'Optimizing…' : 'Optimize'}
            </Button>
          </>
        )
      }
    >
      <div className={form.form}>
        {analysis === null ? (
          <p className={form.summary}>Looking through the document…</p>
        ) : (
          <AnalysisFacts analysis={analysis} />
        )}

        {outcome !== null ? (
          <OutcomeSummary outcome={outcome} />
        ) : (
          <>
            <fieldset className={form.group} disabled={running}>
              <legend className={form.legend}>Preset</legend>
              {PRESETS.map((option) => (
                <label className={form.choice} key={option.id}>
                  <input
                    type="radio"
                    name="optimize-preset"
                    checked={preset === option.id}
                    onChange={() => store().choosePreset(option.id)}
                  />
                  <span className={form.choiceText}>
                    {option.title}
                    <span className={form.hint}>{option.hint}</span>
                  </span>
                </label>
              ))}
              {preset === null && <p className={form.hint}>Custom settings, below.</p>}
            </fieldset>

            <details className={styles.advanced}>
              <summary>Advanced settings</summary>
              <fieldset className={form.group} disabled={running}>
                <legend className={form.legend}>Pictures</legend>
                <div className={form.row}>
                  <label className={form.choice}>
                    <input
                      type="checkbox"
                      checked={settings.downsample}
                      onChange={(event) => set({ downsample: event.target.checked })}
                    />
                    Make pictures smaller when drawn above
                  </label>
                  <input
                    type="number"
                    aria-label="Target resolution in dots per inch"
                    className={`${form.input} ${form.number}`}
                    min={50}
                    max={1200}
                    value={settings.targetDpi}
                    disabled={!settings.downsample}
                    onChange={(event) =>
                      set({ targetDpi: clamp(Number(event.target.value), 50, 1200) })
                    }
                  />
                  <span className={form.hint}>dpi</span>
                </div>
                <div className={form.row}>
                  <label className={form.choice}>
                    <input
                      type="checkbox"
                      checked={settings.recompressJpeg}
                      onChange={(event) => set({ recompressJpeg: event.target.checked })}
                    />
                    Compress JPEG pictures again, at quality
                  </label>
                  <input
                    type="number"
                    aria-label="JPEG quality"
                    className={`${form.input} ${form.number}`}
                    min={10}
                    max={100}
                    value={settings.jpegQuality}
                    onChange={(event) =>
                      set({ jpegQuality: clamp(Number(event.target.value), 10, 100) })
                    }
                  />
                </div>
                <Check
                  label="Store photographs as JPEG"
                  hint="Drawings, screenshots and scanned text keep lossless storage."
                  checked={settings.convertPhotos}
                  onChange={(convertPhotos) => set({ convertPhotos })}
                />
                <Check
                  label="Make colour pictures grey"
                  hint="Only pictures: text and drawings keep their colour."
                  checked={settings.grayscaleImages}
                  onChange={(grayscaleImages) => set({ grayscaleImages })}
                />
              </fieldset>

              <fieldset className={form.group} disabled={running}>
                <legend className={form.legend}>Document</legend>
                <Check
                  label="Compress uncompressed streams"
                  hint="Loses nothing."
                  checked={settings.compressStreams}
                  onChange={(compressStreams) => set({ compressStreams })}
                />
                <Check
                  label="Remove page thumbnails"
                  hint="Readers draw their own."
                  checked={settings.removeThumbnails}
                  onChange={(removeThumbnails) => set({ removeThumbnails })}
                />
                <Check
                  label="Remove objects nothing uses"
                  checked={settings.removeUnused}
                  onChange={(removeUnused) => set({ removeUnused })}
                />
                <Check
                  label="Remove metadata"
                  hint="The title, author, subject and keywords, and the XMP packet."
                  checked={settings.removeMetadata}
                  onChange={(removeMetadata) => set({ removeMetadata })}
                />
                <Check
                  label="Pack objects into compressed streams (qpdf)"
                  hint={
                    qpdf
                      ? 'qpdf also recompresses existing streams harder.'
                      : 'Needs qpdf, which is not installed.'
                  }
                  checked={settings.packObjects && qpdf}
                  disabled={!qpdf}
                  onChange={(packObjects) => set({ packObjects })}
                />
                <Check
                  label="Fast web view (qpdf)"
                  hint={
                    qpdf
                      ? 'Lays the file out so the first page shows before the rest arrives. Any later edit undoes it.'
                      : 'Needs qpdf, which is not installed.'
                  }
                  checked={settings.linearize && qpdf}
                  disabled={!qpdf}
                  onChange={(linearize) => set({ linearize })}
                />
              </fieldset>
            </details>
          </>
        )}
      </div>
    </Dialog>
  );
}

function AnalysisFacts({ analysis }: { analysis: OptimizeAnalysis }): ReactElement {
  const { images } = analysis;
  const pictures =
    images.total === 0
      ? 'None'
      : `${String(images.total)} (${formatBytes(images.bytes)}): ${String(images.jpeg)} JPEG, ${String(
          images.lossless,
        )} lossless${images.untouchable > 0 ? `, ${String(images.untouchable)} PaperForge leaves as they are` : ''}`;

  return (
    <dl className={admin.facts} aria-label="What the document holds">
      <Fact
        term="Size"
        value={`${formatBytes(analysis.sizeBytes)}, ${String(analysis.pageCount)} pages`}
      />
      <Fact term="Pictures" value={pictures} />
      {images.highestDpi !== null && (
        <Fact term="Sharpest picture" value={`Drawn at ${String(images.highestDpi)} dpi`} />
      )}
      <Fact
        term="Uncompressed streams"
        value={analysis.uncompressedStreams === 0 ? 'None' : String(analysis.uncompressedStreams)}
      />
      {analysis.thumbnails > 0 && (
        <Fact term="Page thumbnails" value={String(analysis.thumbnails)} />
      )}
      <Fact term="Fast web view" value={analysis.linearized ? 'Yes' : 'No'} />
    </dl>
  );
}

function OutcomeSummary({ outcome }: { outcome: OptimizeOutcome }): ReactElement {
  if (!outcome.applied) {
    return (
      <p className={styles.result} data-optimize-result="unchanged">
        Nothing came out smaller with these settings, so the document was left as it was.
      </p>
    );
  }

  const { report } = outcome;
  const lines = [
    report.imagesResampled > 0 && `${count(report.imagesResampled, 'picture')} made smaller`,
    report.imagesRecompressed > 0 && `${count(report.imagesRecompressed, 'JPEG')} compressed again`,
    report.imagesConverted > 0 && `${count(report.imagesConverted, 'photograph')} stored as JPEG`,
    report.imagesGreyed > 0 && `${count(report.imagesGreyed, 'picture')} made grey`,
    report.imagesKept > 0 &&
      `${count(report.imagesKept, 'picture')} left as ${report.imagesKept === 1 ? 'it was' : 'they were'}, already as small`,
    report.streamsCompressed > 0 && `${count(report.streamsCompressed, 'stream')} compressed`,
    report.thumbnailsRemoved > 0 && `${count(report.thumbnailsRemoved, 'thumbnail')} removed`,
    report.metadataRemoved && 'Metadata removed',
    report.objectsRemoved > 0 && `${count(report.objectsRemoved, 'unused object')} removed`,
    outcome.qpdf === 'used' && 'Packed by qpdf',
    outcome.qpdf === 'failed' && 'qpdf could not pack the file; PaperForge’s own result was kept',
    outcome.linearized && 'Laid out for fast web view',
  ].filter((line): line is string => typeof line === 'string');

  return (
    <div className={styles.result} data-optimize-result="applied">
      <p className={styles.saving}>{describeSaving(outcome)}</p>
      {lines.length > 0 && (
        <ul className={styles.changes}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <p className={form.hint}>Undo takes it back. Save writes it to the file.</p>
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string }): ReactElement {
  return (
    <div className={admin.fact}>
      <dt className={admin.factTerm}>{term}</dt>
      <dd className={admin.factValue}>{value}</dd>
    </div>
  );
}

function Check({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <label className={form.choice}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={form.choiceText}>
        {label}
        {hint !== undefined && <span className={form.hint}>{hint}</span>}
      </span>
    </label>
  );
}

function count(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? '' : 's'}`;
}

function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.max(low, Math.min(high, Math.round(value))) : low;
}
