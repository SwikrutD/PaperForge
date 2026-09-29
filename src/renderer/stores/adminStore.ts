import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { EmbeddedFile, StagedAttachment } from '@shared/schemas/attachment';
import type {
  CustomMetadataEntry,
  DocumentMetadata,
  DocumentProperties,
} from '@shared/schemas/metadata';
import type { ProtectRequest, SecuritySummary } from '@shared/schemas/protect';
import type { SanitizeCategory, SanitizeReport } from '@shared/schemas/sanitize';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/** Which document and revision a reading belongs to. */
interface Loaded {
  sessionId: string;
  revision: number;
}

interface AdminStore {
  properties: DocumentProperties | null;
  propertiesFor: Loaded | null;
  attachments: EmbeddedFile[];
  attachmentsFor: Loaded | null;
  report: SanitizeReport | null;
  reportFor: Loaded | null;
  busy: boolean;

  /** Reads document properties for a revision, once. */
  loadProperties: (sessionId: string, revision: number) => Promise<void>;
  loadAttachments: (sessionId: string, revision: number) => Promise<void>;
  /** Scans for hidden information. Always re-reads: it is an explicit action. */
  scan: (sessionId: string) => Promise<SanitizeReport | null>;

  /** Writes metadata, the custom entries and the document language as one step. */
  saveMetadata: (
    metadata: DocumentMetadata,
    custom: readonly CustomMetadataEntry[],
    options: { removeXmp: boolean; language: string | null },
  ) => Promise<boolean>;

  attachFiles: () => Promise<void>;
  saveAttachment: (id: string) => Promise<void>;
  removeAttachments: (ids: readonly string[]) => Promise<void>;
  removeHiddenInformation: (categories: readonly SanitizeCategory[]) => Promise<boolean>;

  /** Writes a protected copy; returns where it went, or null. */
  protect: (request: Omit<ProtectRequest, 'sessionId'>) => Promise<string | null>;
  unprotect: (password: string) => Promise<string | null>;
}

function activeSessionId(): string | null {
  return useDocumentStore.getState().activeId;
}

function report(error: unknown): void {
  const serialized = AppError.serialize(error);
  useUiStore.getState().showToast({
    title: serialized.message,
    description: serialized.details,
    intent: 'error',
  });
}

/** True when the reading that has just arrived is still the one being shown. */
function stillCurrent(loaded: Loaded): boolean {
  const state = useDocumentStore.getState();
  if (state.activeId !== loaded.sessionId) return false;
  const tab = state.tabs.find((candidate) => candidate.session.id === loaded.sessionId);
  return tab?.edit.revision === loaded.revision;
}

/**
 * Document administration: properties, attachments and hidden information.
 *
 * Nothing here is a private copy of the document. Every reading is tagged with
 * the revision it came from and thrown away when the document changes, so a
 * panel cannot show what the file said two edits ago.
 *
 * Passwords are never kept. A protect request carries them to the main
 * process and the store holds nothing afterwards.
 */
export const useAdminStore = create<AdminStore>((set, get) => ({
  properties: null,
  propertiesFor: null,
  attachments: [],
  attachmentsFor: null,
  report: null,
  reportFor: null,
  busy: false,

  loadProperties: async (sessionId, revision) => {
    const loaded = get().propertiesFor;
    if (loaded?.sessionId === sessionId && loaded.revision === revision) return;

    try {
      const properties = await invoke('document:properties', { sessionId });
      if (!stillCurrent({ sessionId, revision })) return;
      set({ properties, propertiesFor: { sessionId, revision } });
    } catch (error) {
      report(error);
      set({ properties: null, propertiesFor: { sessionId, revision } });
    }
  },

  loadAttachments: async (sessionId, revision) => {
    const loaded = get().attachmentsFor;
    if (loaded?.sessionId === sessionId && loaded.revision === revision) return;

    try {
      const attachments = await invoke('attachments:list', { sessionId });
      if (!stillCurrent({ sessionId, revision })) return;
      set({ attachments, attachmentsFor: { sessionId, revision } });
    } catch (error) {
      report(error);
      set({ attachments: [], attachmentsFor: { sessionId, revision } });
    }
  },

  scan: async (sessionId) => {
    set({ busy: true });
    try {
      const scanned = await invoke('sanitize:scan', { sessionId });
      const revision = revisionOf(sessionId);
      set({ report: scanned, reportFor: { sessionId, revision } });
      return scanned;
    } catch (error) {
      report(error);
      return null;
    } finally {
      set({ busy: false });
    }
  },

  saveMetadata: async (metadata, custom, options) => {
    const sessionId = activeSessionId();
    if (sessionId === null) return false;

    const current = get().properties;
    const languageChanged = (current?.language ?? null) !== options.language;

    try {
      await useDocumentStore.getState().applyEdit(sessionId, {
        label: 'Change document properties',
        operations: [
          {
            kind: 'setMetadata',
            metadata,
            custom: [...custom],
            removeXmpMetadata: options.removeXmp,
          },
          ...(languageChanged
            ? [{ kind: 'setDocumentLanguage' as const, language: options.language }]
            : []),
        ],
      });
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  },

  attachFiles: async () => {
    const sessionId = activeSessionId();
    if (sessionId === null) return;

    set({ busy: true });
    try {
      const staged: StagedAttachment[] = await invoke('attachments:choose', { sessionId });
      if (staged.length === 0) return;

      await useDocumentStore.getState().applyEdit(sessionId, {
        label: staged.length === 1 ? 'Attach a file' : 'Attach files',
        operations: [{ kind: 'addAttachments', tokens: staged.map((file) => file.token) }],
      });

      const risky = staged.filter((file) => file.risky);
      if (risky.length > 0) {
        useUiStore.getState().showToast({
          title: 'Attached a file that Windows can run',
          description: `${risky.map((file) => file.fileName).join(', ')}. PaperForge will never open it, and anyone you send this document to should be told it is there.`,
          intent: 'warning',
        });
      }
    } catch (error) {
      report(error);
    } finally {
      set({ busy: false });
    }
  },

  saveAttachment: async (id) => {
    const sessionId = activeSessionId();
    if (sessionId === null) return;

    set({ busy: true });
    try {
      const outcome = await invoke('attachments:save', { sessionId, id });
      if (outcome.canceled || outcome.path === null) return;
      useUiStore.getState().showToast({
        title: 'Attachment saved',
        description: `${outcome.path}. PaperForge did not open it.`,
        intent: 'success',
      });
    } catch (error) {
      report(error);
    } finally {
      set({ busy: false });
    }
  },

  removeAttachments: async (ids) => {
    const sessionId = activeSessionId();
    if (sessionId === null || ids.length === 0) return;

    try {
      await useDocumentStore.getState().applyEdit(sessionId, {
        label: ids.length === 1 ? 'Remove an attachment' : 'Remove attachments',
        operations: [{ kind: 'removeAttachments', ids: [...ids] }],
      });
    } catch (error) {
      report(error);
    }
  },

  removeHiddenInformation: async (categories) => {
    const sessionId = activeSessionId();
    if (sessionId === null || categories.length === 0) return false;

    try {
      await useDocumentStore.getState().applyEdit(sessionId, {
        label: 'Remove hidden information',
        operations: [{ kind: 'sanitize', categories: [...categories] }],
      });
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  },

  protect: async (request) => {
    const sessionId = activeSessionId();
    if (sessionId === null) return null;

    set({ busy: true });
    try {
      const outcome = await invoke('protect:apply', { sessionId, ...request });
      return outcome.canceled ? null : outcome.path;
    } catch (error) {
      report(error);
      return null;
    } finally {
      set({ busy: false });
    }
  },

  unprotect: async (password) => {
    const sessionId = activeSessionId();
    if (sessionId === null) return null;

    set({ busy: true });
    try {
      const outcome = await invoke('protect:remove', { sessionId, password });
      return outcome.canceled ? null : outcome.path;
    } catch (error) {
      report(error);
      return null;
    } finally {
      set({ busy: false });
    }
  },
}));

function revisionOf(sessionId: string): number {
  const state = useDocumentStore.getState();
  return state.tabs.find((tab) => tab.session.id === sessionId)?.edit.revision ?? 0;
}

/** The security summary of the document being shown, when one has been read. */
export function securityOf(store: AdminStore): SecuritySummary | null {
  return store.properties?.security ?? null;
}
