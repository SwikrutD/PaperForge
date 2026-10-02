import { useState, type ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import type { Annotation } from '@shared/schemas/annotation';
import {
  MEASUREMENT_UNITS,
  actualSizeScale,
  formatMeasurement,
  isMeasurementUnit,
  measure,
  measuredPoints,
  type MeasurementUnit,
} from '@shared/utils/measure';
import { annotationsForSession, useAnnotationStore } from '../../stores/annotationStore';
import { useDocumentStore } from '../../stores/documentStore';
import { useMeasureStore } from '../../stores/measureStore';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { cx } from '../../utils/classNames';
import form from '../overlays/dialogForm.module.css';
import styles from './MeasurePanel.module.css';

/**
 * The scale measurements are made at, calibrating it, and the measurements
 * the document already carries.
 */
export function MeasurePanel(): ReactElement {
  const tab = useDocumentStore(
    (state) => state.tabs.find((candidate) => candidate.session.id === state.activeId) ?? null,
  );
  const sessionId = tab?.session.id ?? '';
  const calibrated = useMeasureStore((state) => state.scales[sessionId]);
  const unit = useMeasureStore((state) => state.unit);
  const scale = calibrated ?? actualSizeScale(unit);
  const calibration = useMeasureStore((state) =>
    state.calibration?.sessionId === sessionId ? state.calibration : null,
  );
  const annotations = useAnnotationStore((state) => annotationsForSession(state, sessionId));
  const selectedId = useAnnotationStore((state) => state.selectedId);
  const store = useMeasureStore.getState;

  const measurements = annotations.filter((annotation) => annotation.measure !== undefined);
  const selected = measurements.find((annotation) => annotation.id === selectedId) ?? null;

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>Measure</h2>
        <p className={styles.note}>
          Measurements are saved in the document as comments that carry their scale.
        </p>
      </header>

      <fieldset className={form.group}>
        <legend className={form.legend}>Scale</legend>
        <p className={styles.scale} data-measure-scale>
          {calibrated === undefined ? `Actual size, in ${unit}` : `Calibrated: ${scale.label}`}
        </p>
        {calibrated === undefined ? (
          <div className={form.row}>
            <label className={form.label} htmlFor="measure-unit">
              Unit
            </label>
            <UnitSelect id="measure-unit" value={unit} onChange={(next) => store().setUnit(next)} />
          </div>
        ) : (
          <div className={styles.actions}>
            <Button onClick={() => store().setScale(sessionId, null)}>Use actual size</Button>
          </div>
        )}
        {selected?.measure !== undefined && (
          <div className={styles.actions}>
            <Button
              onClick={() =>
                selected.measure !== undefined &&
                store().setScale(sessionId, selected.measure.scale)
              }
            >
              Use the selected measurement&apos;s scale
            </Button>
          </div>
        )}
        {calibration === null ? (
          <p className={styles.hint}>
            To measure a drawing at its own scale, choose Calibrate scale and click both ends of
            something whose length you know.
          </p>
        ) : (
          <CalibrationForm lengthPoints={calibration.lengthPoints} />
        )}
      </fieldset>

      <section className={styles.list} aria-label="Measurements in this document">
        <h3 className={styles.subtitle}>In this document</h3>
        {measurements.length === 0 ? (
          <p className={styles.hint}>No measurements yet.</p>
        ) : (
          <ul className={styles.items}>
            {measurements.map((annotation) => (
              <MeasurementEntry
                key={annotation.id}
                annotation={annotation}
                sessionId={sessionId}
                selected={annotation.id === selectedId}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CalibrationForm({ lengthPoints }: { lengthPoints: number }): ReactElement {
  const [length, setLength] = useState('');
  const [unit, setUnit] = useState<MeasurementUnit>(useMeasureStore.getState().unit);
  const value = Number.parseFloat(length);
  const valid = Number.isFinite(value) && value > 0;

  return (
    <form
      className={styles.calibration}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) useMeasureStore.getState().calibrate(value, unit);
      }}
    >
      <p className={styles.hint}>
        {`That line is ${String(Math.round((lengthPoints / 72) * 100) / 100)} in on the page. How long is it really?`}
      </p>
      <div className={form.row}>
        <input
          type="number"
          className={`${form.input} ${form.number}`}
          aria-label="Real length"
          min={0}
          step="any"
          value={length}
          // The question has just been asked; the answer goes straight in.
          autoFocus
          onChange={(event) => setLength(event.target.value)}
        />
        <UnitSelect id="calibration-unit" value={unit} onChange={setUnit} />
      </div>
      <div className={styles.actions}>
        <Button onClick={() => useMeasureStore.getState().cancelCalibration()}>Cancel</Button>
        <Button type="submit" appearance="primary" disabled={!valid}>
          Set scale
        </Button>
      </div>
    </form>
  );
}

function UnitSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: MeasurementUnit;
  onChange: (unit: MeasurementUnit) => void;
}): ReactElement {
  return (
    <select
      id={id}
      className={form.select}
      aria-label="Unit"
      value={value}
      onChange={(event) => {
        if (isMeasurementUnit(event.target.value)) onChange(event.target.value);
      }}
    >
      {MEASUREMENT_UNITS.map((entry) => (
        <option key={entry} value={entry}>
          {entry}
        </option>
      ))}
    </select>
  );
}

function MeasurementEntry({
  annotation,
  sessionId,
  selected,
}: {
  annotation: Annotation;
  sessionId: string;
  selected: boolean;
}): ReactElement | null {
  const updateView = useDocumentStore((state) => state.updateView);
  const measurement = annotation.measure;
  if (measurement === undefined) return null;
  const value = measure(measurement.kind, measuredPoints(annotation.geometry), measurement.scale);

  return (
    <li className={cx(styles.item, selected && styles.itemSelected)}>
      <button
        type="button"
        className={styles.itemButton}
        onClick={() => {
          useAnnotationStore.getState().select(annotation.id);
          updateView(sessionId, { pendingPage: annotation.pageNumber });
        }}
      >
        <span className={styles.itemKind}>{measurement.kind}</span>
        <span className={styles.itemValue}>
          {formatMeasurement(value, measurement.kind, measurement.scale.unit)}
        </span>
        <span className={styles.itemPage}>{`p. ${String(annotation.pageNumber)}`}</span>
      </button>
      <IconButton
        icon={Trash2}
        size="small"
        label={`Delete this ${measurement.kind} measurement`}
        onClick={() => void useAnnotationStore.getState().remove([annotation.id])}
      />
    </li>
  );
}
