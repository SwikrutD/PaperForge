import {
  Accessibility,
  Combine,
  EyeOff,
  FileOutput,
  FilePlus2,
  FileText,
  GitCompare,
  LayoutGrid,
  Minimize2,
  MessageSquare,
  PenLine,
  ScanText,
  ShieldCheck,
  ShieldX,
  Signature,
  TextCursorInput,
  type LucideIcon,
} from 'lucide-react';

export interface ToolCatalogEntry {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** The command that runs this tool. */
  commandId: string;
}

/**
 * The tools PaperForge provides (CLAUDE.md section 6.2). Each card runs a
 * registered command, so it is available exactly when that command is.
 */
export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  {
    id: 'edit',
    title: 'Edit PDF',
    description: 'Change text and images on the page.',
    icon: PenLine,
    commandId: 'tools.edit',
  },
  {
    id: 'create',
    title: 'Create PDF',
    description: 'Start from images, text or a blank page.',
    icon: FilePlus2,
    commandId: 'tools.create',
  },
  {
    id: 'export',
    title: 'Export PDF',
    description: 'Save as images, text, Word, Excel or PowerPoint.',
    icon: FileOutput,
    commandId: 'tools.export',
  },
  {
    id: 'combine',
    title: 'Combine Files',
    description: 'Merge several documents into one.',
    icon: Combine,
    commandId: 'tools.combine',
  },
  {
    id: 'organize',
    title: 'Organize Pages',
    description: 'Reorder, rotate, extract, split and insert pages.',
    icon: LayoutGrid,
    commandId: 'tools.organize',
  },
  {
    id: 'comment',
    title: 'Comment',
    description: 'Highlight, draw, and leave notes.',
    icon: MessageSquare,
    commandId: 'tools.comment',
  },
  {
    id: 'fillSign',
    title: 'Fill & Sign',
    description: 'Complete form fields and add a simple signature.',
    icon: Signature,
    commandId: 'tools.fillSign',
  },
  {
    id: 'ocr',
    title: 'Recognize Text',
    description: 'Make a scanned document searchable, entirely on this computer.',
    icon: ScanText,
    commandId: 'tools.ocr',
  },
  {
    id: 'protect',
    title: 'Protect PDF',
    description: 'Add a password and set permissions.',
    icon: ShieldCheck,
    commandId: 'tools.protect',
  },
  {
    id: 'redact',
    title: 'Redact',
    description: 'Remove sensitive content for good, not just cover it.',
    icon: EyeOff,
    commandId: 'tools.redact',
  },
  {
    id: 'optimize',
    title: 'Optimize PDF',
    description: 'Reduce file size with control over quality.',
    icon: Minimize2,
    commandId: 'tools.optimize',
  },
  {
    id: 'compare',
    title: 'Compare Files',
    description: 'See what changed between two versions.',
    icon: GitCompare,
    commandId: 'tools.compare',
  },
  {
    id: 'prepareForm',
    title: 'Prepare Form',
    description: 'Add fields, checkboxes and buttons.',
    icon: TextCursorInput,
    commandId: 'tools.prepareForm',
  },
  {
    id: 'sanitize',
    title: 'Remove Hidden Information',
    description: 'Find and remove metadata, attachments and scripts.',
    icon: ShieldX,
    commandId: 'tools.sanitize',
  },
  {
    id: 'accessibility',
    title: 'Accessibility Check',
    description: 'Find missing titles, languages and alt text.',
    icon: Accessibility,
    commandId: 'tools.accessibility',
  },
  {
    id: 'properties',
    title: 'Document Properties',
    description: 'Inspect and edit metadata and security.',
    icon: FileText,
    commandId: 'tools.properties',
  },
];
