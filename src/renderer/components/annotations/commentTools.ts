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
import type { AnnotationTool } from '../../stores/annotationStore';

/**
 * The comment tools: the comment toolbar's buttons and the Tools pane's list
 * are both made from this, so the two never disagree.
 */

export interface ToolEntry {
  tool: AnnotationTool;
  label: string;
  icon: typeof Square;
}

/** The tools, grouped the way a reader thinks about them. */
export const COMMENT_TOOL_GROUPS: ToolEntry[][] = [
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

/** Says how a tool is used, because a drag and a click are not the same. */
export function commentToolTooltip(entry: ToolEntry): string {
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
