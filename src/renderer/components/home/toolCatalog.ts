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
  /** The command that runs this tool. Absent until the tool is built. */
  commandId?: string;
  /** What has to land first, shown plainly while the tool is unavailable. */
  requires: string;
}

/**
 * The tools PaperForge is being built to provide (CLAUDE.md section 6.2).
 *
 * A card is only interactive when `commandId` names a registered command, so a
 * tool cannot be started before it works. Tools without one render as clearly
 * unavailable rather than pretending.
 */
export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  {
    id: 'edit',
    title: 'Edit PDF',
    description: 'Change text and images on the page.',
    icon: PenLine,
    commandId: 'tools.edit',
    requires: 'the PDF editor',
  },
  {
    id: 'create',
    title: 'Create PDF',
    description: 'Start from images, text or a blank page.',
    icon: FilePlus2,
    commandId: 'tools.create',
    requires: 'document creation',
  },
  {
    id: 'export',
    title: 'Export PDF',
    description: 'Save as images, text, Word, Excel or PowerPoint.',
    icon: FileOutput,
    commandId: 'tools.export',
    requires: 'the conversion centre',
  },
  {
    id: 'combine',
    title: 'Combine Files',
    description: 'Merge several documents into one.',
    icon: Combine,
    commandId: 'tools.combine',
    requires: 'document creation',
  },
  {
    id: 'organize',
    title: 'Organize Pages',
    description: 'Reorder, rotate, extract, split and insert pages.',
    icon: LayoutGrid,
    commandId: 'tools.organize',
    requires: 'page organisation',
  },
  {
    id: 'comment',
    title: 'Comment',
    description: 'Highlight, draw, and leave notes.',
    icon: MessageSquare,
    commandId: 'tools.comment',
    requires: 'annotations',
  },
  {
    id: 'fillSign',
    title: 'Fill & Sign',
    description: 'Complete form fields and add a simple signature.',
    icon: Signature,
    commandId: 'tools.fillSign',
    requires: 'forms',
  },
  {
    id: 'ocr',
    title: 'Recognize Text',
    description: 'Make a scanned document searchable, entirely on this computer.',
    icon: ScanText,
    commandId: 'tools.ocr',
    requires: 'local OCR',
  },
  {
    id: 'protect',
    title: 'Protect PDF',
    description: 'Add a password and set permissions.',
    icon: ShieldCheck,
    commandId: 'tools.protect',
    requires: 'document security',
  },
  {
    id: 'redact',
    title: 'Redact',
    description: 'Remove sensitive content for good, not just cover it.',
    icon: EyeOff,
    commandId: 'tools.redact',
    requires: 'redaction',
  },
  {
    id: 'optimize',
    title: 'Optimize PDF',
    description: 'Reduce file size with control over quality.',
    icon: Minimize2,
    requires: 'optimisation',
  },
  {
    id: 'compare',
    title: 'Compare Files',
    description: 'See what changed between two versions.',
    icon: GitCompare,
    requires: 'comparison',
  },
  {
    id: 'prepareForm',
    title: 'Prepare Form',
    description: 'Add fields, checkboxes and buttons.',
    icon: TextCursorInput,
    commandId: 'tools.prepareForm',
    requires: 'form authoring',
  },
  {
    id: 'sanitize',
    title: 'Remove Hidden Information',
    description: 'Find and remove metadata, attachments and scripts.',
    icon: ShieldX,
    commandId: 'tools.sanitize',
    requires: 'document administration',
  },
  {
    id: 'accessibility',
    title: 'Accessibility Check',
    description: 'Find missing titles, languages and alt text.',
    icon: Accessibility,
    requires: 'the accessibility checker',
  },
  {
    id: 'properties',
    title: 'Document Properties',
    description: 'Inspect and edit metadata and security.',
    icon: FileText,
    commandId: 'tools.properties',
    requires: 'document administration',
  },
];
