import { useEffect, type ReactElement } from 'react';
import {
  Circle,
  Highlighter,
  MessageSquarePlus,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Minus,
  Pencil,
  Image as ImageIcon,
  Square,
  Stamp,
  Strikethrough,
  Triangle,
  Type,
  Underline,
  AudioWaveform,
  Eraser,
  Spline,
} from 'lucide-react';
import { IconButton } from '../controls/IconButton';
import { useAnnotationStore, type AnnotationTool } from '../../stores/annotationStore';
import styles from './AnnotationToolbar.module.css';

interface ToolEntry {
  tool: AnnotationTool;
  label: string;
  icon: typeof Square;
}

/** The tools, grouped the way a reader thinks about them. */
const GROUPS: ToolEntry[][] = [
  [{ tool: 'select', label: 'Select', icon: MousePointer2 }],
  [
    { tool: 'highlight', label: 'Highlight', icon: Highlighter },
    { tool: 'underline', label: 'Underline', icon: Underline },
    { tool: 'strikeOut', label: 'Strikethrough', icon: Strikethrough },
    { tool: 'squiggly', label: 'Squiggly underline', icon: AudioWaveform },
  ],
  [
    { tool: 'note', label: 'Sticky note', icon: MessageSquarePlus },
    { tool: 'freeText', label: 'Text box', icon: Type },
    { tool: 'callout', label: 'Callout', icon: PenLine },
  ],
  [
    { tool: 'square', label: 'Rectangle', icon: Square },
    { tool: 'circle', label: 'Ellipse', icon: Circle },
    { tool: 'line', label: 'Line', icon: Minus },
    { tool: 'arrow', label: 'Arrow', icon: MoveUpRight },
    { tool: 'polygon', label: 'Polygon', icon: Triangle },
    { tool: 'polyline', label: 'Polyline', icon: Spline },
  ],
  [
    { tool: 'ink', label: 'Draw', icon: Pencil },
    { tool: 'eraser', label: 'Erase drawing', icon: Eraser },
  ],
  [
    { tool: 'stamp', label: 'Stamp', icon: Stamp },
    { tool: 'imageStamp', label: 'Image stamp', icon: ImageIcon },
  ],
];

/**
 * The comment tools.
 *
 * It appears under the viewer toolbar while commenting is on, so the page
 * keeps as much room as it can when the reader is only reading.
 */
export function AnnotationToolbar({ disabled }: { disabled: boolean }): ReactElement {
  const tool = useAnnotationStore((state) => state.tool);
  const setTool = useAnnotationStore((state) => state.setTool);

  // Escape puts the pointer back to selecting, the way every drawing tool
  // behaves. A dialog or the find bar handles its own Escape first.
  useEffect(() => {
    if (tool === 'select') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setTool('select');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tool, setTool]);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Comment tools">
      {GROUPS.map((group, index) => (
        <div className={styles.group} key={group[0]?.tool ?? index}>
          {index > 0 && <span className={styles.divider} aria-hidden="true" />}
          {group.map((entry) => (
            <IconButton
              key={entry.tool}
              icon={entry.icon}
              label={entry.label}
              tooltip={tooltipFor(entry)}
              pressed={tool === entry.tool}
              disabled={disabled}
              onClick={() => setTool(tool === entry.tool ? 'select' : entry.tool)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Says how a tool is used, because a drag and a click are not the same. */
function tooltipFor(entry: ToolEntry): string {
  switch (entry.tool) {
    case 'select':
      return 'Select (Esc)';
    case 'highlight':
    case 'underline':
    case 'strikeOut':
    case 'squiggly':
      return `${entry.label}: select the text to mark`;
    case 'note':
      return 'Sticky note: click where it belongs';
    case 'ink':
      return 'Draw: hold and move';
    case 'eraser':
      return 'Erase: click a drawing to remove it';
    case 'polygon':
    case 'polyline':
      return `${entry.label}: hold and move around the shape`;
    case 'imageStamp':
      return 'Image stamp: choose a picture, then click to place it';
    default:
      return `${entry.label}: drag out the shape`;
  }
}
