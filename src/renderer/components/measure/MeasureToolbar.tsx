import { useEffect, type ReactElement } from 'react';
import { Pentagon, Ruler, Spline, TriangleRight } from 'lucide-react';
import { useCommands } from '../../commands/useCommands';
import { pointsNeeded, useMeasureStore, type MeasureTool } from '../../stores/measureStore';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import styles from '../redact/RedactionToolbar.module.css';

const TOOLS: Array<{ tool: MeasureTool; label: string; icon: typeof Ruler }> = [
  { tool: 'distance', label: 'Distance', icon: Ruler },
  { tool: 'perimeter', label: 'Perimeter', icon: Spline },
  { tool: 'area', label: 'Area', icon: Pentagon },
  { tool: 'calibrate', label: 'Calibrate scale', icon: TriangleRight },
];

const HINTS: Record<MeasureTool, string> = {
  distance: 'Click where the distance starts and where it ends.',
  perimeter: 'Click each corner; double-click or press Enter to finish.',
  area: 'Click each corner of the area; double-click or press Enter to close it.',
  calibrate: 'Click both ends of something whose real length you know.',
};

/**
 * The measuring tools, under the viewer toolbar. Enter finishes a shape,
 * Backspace takes its last point back, and Escape abandons it.
 */
export function MeasureToolbar(): ReactElement {
  const { execute } = useCommands();
  const tool = useMeasureStore((state) => state.tool);
  const drafting = useMeasureStore((state) => state.draft !== null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const store = useMeasureStore.getState();
      if (store.draft === null || event.defaultPrevented) return;
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'Escape') store.cancel();
      else if (event.key === 'Backspace') store.removeLastPoint();
      else if (event.key === 'Enter') void store.finish();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Measuring tools">
      <div className={styles.group}>
        {TOOLS.map((entry) => (
          <IconButton
            key={entry.tool}
            icon={entry.icon}
            label={entry.label}
            pressed={tool === entry.tool}
            onClick={() => useMeasureStore.getState().setTool(entry.tool)}
          />
        ))}
      </div>
      <span>
        {drafting && pointsNeeded(tool) > 2
          ? 'Double-click or press Enter to finish; Backspace removes the last point.'
          : HINTS[tool]}
      </span>
      <span className={styles.spacer} />
      <div className={styles.group}>
        <Button onClick={() => execute('tools.measure')}>Done</Button>
      </div>
    </div>
  );
}
