import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CustomMetadataEntry, DocumentMetadata } from '@shared/schemas/metadata';
import { EMPTY_METADATA } from '@shared/schemas/metadata';
import { useAdminStore } from '../../stores/adminStore';
import { useDocumentStore } from '../../stores/documentStore';
import { useUiStore } from '../../stores/uiStore';
import { formatBytes } from '../../utils/format';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { Dialog } from '../overlays/Dialog';
import { cx } from '../../utils/classNames';
import form from '../overlays/dialogForm.module.css';
import styles from './admin.module.css';
import { SecuritySummaryView } from './SecuritySummaryView';

type PaneId = 'description' | 'security' | 'fonts' | 'advanced';

const PANES: Array<{ id: PaneId; label: string }> = [
  { id: 'description', label: 'Description' },
  { id: 'security', label: 'Security' },
  { id: 'fonts', label: 'Fonts' },
  { id: 'advanced', label: 'Advanced' },
];

const FIELDS: Array<{ key: keyof DocumentMetadata; label: string; multiline?: boolean }> = [
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'subject', label: 'Subject' },
  { key: 'keywords', label: 'Keywords', multiline: true },
];

/** A text box writes '' for "nothing typed"; the document wants a missing entry. */
function toEntry(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asText(value: string | null): string {
  return value ?? '';
}

/** "12 March 2024, 09:41" — a date the document states, in the reader's locale. */
function formatDate(iso: string | null): string {
  if (iso === null) return 'Not stated';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Not stated' : date.toLocaleString();
}

/**
 * Document Properties.
 *
 * The description fields are editable and go through the ordinary edit
 * pipeline, so changing a title is undoable and is not written to disk until
 * the document is saved. Everything else is read from the document and stated
 * as it is — a fact the file does not carry is reported as missing rather than
 * guessed at.
 */
export function DocumentPropertiesDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore((state) => {
    const active = state.activeId;
    return state.tabs.find((candidate) => candidate.session.id === active) ?? null;
  });
  const properties = useAdminStore((state) => state.properties);
  const loadedFor = useAdminStore((state) => state.propertiesFor);
  const load = useAdminStore((state) => state.loadProperties);
  const showToast = useUiStore((state) => state.showToast);

  // Null means "as the document has it". Nothing is copied out of the document
  // until the reader types, so a reading that arrives late is never overwritten
  // by an empty form.
  const [pane, setPane] = useState<PaneId>('description');
  const [draft, setDraft] = useState<DocumentMetadata | null>(null);
  const [custom, setCustom] = useState<CustomMetadataEntry[] | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [removeXmp, setRemoveXmp] = useState(false);
  const [saving, setSaving] = useState(false);

  const sessionId = tab?.session.id ?? null;
  const revision = tab?.edit.revision ?? 0;

  useEffect(() => {
    if (sessionId === null) return;
    void load(sessionId, revision);
  }, [load, sessionId, revision]);

  const ready =
    properties !== null && loadedFor?.sessionId === sessionId && loadedFor.revision === revision;

  const stated = ready ? properties.metadata : EMPTY_METADATA;
  const metadata = draft ?? stated;
  const entries = useMemo(
    () => custom ?? (ready ? properties.custom : []),
    [custom, ready, properties],
  );
  const languageText = language ?? (ready ? (properties.language ?? '') : '');

  const changed = useMemo(() => {
    if (!ready) return false;
    const sameFields = (Object.keys(metadata) as Array<keyof DocumentMetadata>).every(
      (key) => metadata[key] === properties.metadata[key],
    );
    const sameCustom =
      entries.length === properties.custom.length &&
      entries.every(
        (entry, index) =>
          entry.name === properties.custom[index]?.name &&
          entry.value === properties.custom[index]?.value,
      );
    return (
      !sameFields ||
      !sameCustom ||
      removeXmp ||
      toEntry(languageText) !== (properties.language ?? null)
    );
  }, [ready, entries, metadata, properties, removeXmp, languageText]);

  const setField = (key: keyof DocumentMetadata, value: string): void => {
    setDraft((current) => ({ ...(current ?? stated), [key]: toEntry(value) }));
  };

  const editCustom = (change: (list: CustomMetadataEntry[]) => CustomMetadataEntry[]): void => {
    setCustom((current) => change(current ?? (ready ? [...properties.custom] : [])));
  };

  const apply = async (): Promise<void> => {
    if (!ready) return;
    setSaving(true);
    try {
      const saved = await useAdminStore.getState().saveMetadata(metadata, entries, {
        removeXmp,
        language: toEntry(languageText),
      });
      if (!saved) return;
      showToast({
        title: 'Document properties changed',
        description: 'Save the document to write them to the file.',
        intent: 'success',
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title="Document Properties"
      {...(tab === null ? {} : { description: tab.session.file.displayName })}
      onClose={onClose}
      footer={
        <>
          {/* Not "Close": the dialog's own corner control already has that
              name, and two controls in one dialog should not share one. */}
          <Button onClick={onClose}>Done</Button>
          <Button
            appearance="primary"
            disabled={!changed || saving || !ready}
            onClick={() => void apply()}
          >
            Apply changes
          </Button>
        </>
      }
    >
      <div className={styles.tabs} role="tablist" aria-label="Document properties">
        {PANES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={pane === entry.id}
            className={cx(styles.tab, pane === entry.id && styles.tabActive)}
            onClick={() => setPane(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className={styles.pane} role="tabpanel">
        {!ready || tab === null ? (
          <p className={form.summary}>Reading what this document says about itself…</p>
        ) : pane === 'description' ? (
          <div className={form.form}>
            {FIELDS.map((field) => (
              <div key={field.key} className={form.row}>
                <label className={form.label} htmlFor={`property-${field.key}`}>
                  {field.label}
                </label>
                <input
                  id={`property-${field.key}`}
                  className={cx(form.input, form.grow)}
                  value={asText(metadata[field.key])}
                  maxLength={2000}
                  onChange={(event) => setField(field.key, event.target.value)}
                />
              </div>
            ))}

            <div className={form.row}>
              <label className={form.label} htmlFor="property-language">
                Language
              </label>
              <input
                id="property-language"
                className={cx(form.input, form.grow)}
                value={languageText}
                maxLength={100}
                placeholder="e.g. en-GB"
                onChange={(event) => setLanguage(event.target.value)}
              />
            </div>

            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt className={styles.factTerm}>Created</dt>
                <dd className={styles.factValue}>{formatDate(properties.metadata.createdAt)}</dd>
              </div>
              <div className={styles.fact}>
                <dt className={styles.factTerm}>Modified</dt>
                <dd className={styles.factValue}>{formatDate(properties.metadata.modifiedAt)}</dd>
              </div>
              <div className={styles.fact}>
                <dt className={styles.factTerm}>Application</dt>
                <dd className={styles.factValue}>{properties.metadata.creator ?? 'Not stated'}</dd>
              </div>
              <div className={styles.fact}>
                <dt className={styles.factTerm}>PDF producer</dt>
                <dd className={styles.factValue}>{properties.metadata.producer ?? 'Not stated'}</dd>
              </div>
            </dl>

            <fieldset className={form.group}>
              <legend className={form.legend}>Custom entries</legend>
              {entries.length === 0 && (
                <p className={form.hint}>This document carries no custom metadata.</p>
              )}
              {entries.map((entry, index) => (
                <div key={`custom-${String(index)}`} className={styles.customRow}>
                  <input
                    className={form.input}
                    aria-label={`Custom entry ${String(index + 1)} name`}
                    value={entry.name}
                    maxLength={200}
                    onChange={(event) =>
                      editCustom((list) =>
                        list.map((item, position) =>
                          position === index ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <input
                    className={cx(form.input, form.grow)}
                    aria-label={`Custom entry ${String(index + 1)} value`}
                    value={entry.value}
                    maxLength={2000}
                    onChange={(event) =>
                      editCustom((list) =>
                        list.map((item, position) =>
                          position === index ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    size="small"
                    label={`Remove ${entry.name === '' ? 'this entry' : entry.name}`}
                    onClick={() =>
                      editCustom((list) => list.filter((_, position) => position !== index))
                    }
                  />
                </div>
              ))}
              <div>
                <Button
                  icon={Plus}
                  onClick={() => editCustom((list) => [...list, { name: '', value: '' }])}
                >
                  Add entry
                </Button>
              </div>
            </fieldset>

            {properties.hasXmpMetadata && (
              <label className={form.choice}>
                <input
                  type="checkbox"
                  checked={removeXmp}
                  onChange={(event) => setRemoveXmp(event.target.checked)}
                />
                <span className={form.choiceText}>
                  Remove the XMP metadata packet
                  <span className={form.hint}>
                    This document carries an XML copy of its metadata as well. Leaving it behind
                    means the two can disagree.
                  </span>
                </span>
              </label>
            )}
          </div>
        ) : pane === 'security' ? (
          <SecuritySummaryView security={properties.security} />
        ) : pane === 'fonts' ? (
          properties.fonts.length === 0 ? (
            <p className={form.summary}>
              No fonts are named by the pages of this document. A scanned document draws pictures,
              not text.
            </p>
          ) : (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Font</th>
                    <th scope="col">Type</th>
                    <th scope="col">Encoding</th>
                    <th scope="col">Embedded</th>
                  </tr>
                </thead>
                <tbody>
                  {properties.fonts.map((font) => (
                    <tr key={font.name}>
                      <td>{font.name}</td>
                      <td>{font.type}</td>
                      <td>{font.encoding ?? '—'}</td>
                      <td>{font.embedded ? (font.subset ? 'Subset' : 'Yes') : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt className={styles.factTerm}>Location</dt>
              <dd className={styles.factValue}>{tab.session.file.path}</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factTerm}>File size</dt>
              <dd className={styles.factValue}>{formatBytes(tab.session.file.sizeBytes)}</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factTerm}>PDF version</dt>
              <dd className={styles.factValue}>{tab.session.file.pdfVersion ?? 'Not stated'}</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factTerm}>Pages</dt>
              <dd className={styles.factValue}>{String(properties.pageCount)}</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factTerm}>Page size</dt>
              <dd className={styles.factValue}>
                {properties.pageSizes.length === 0
                  ? 'Not known'
                  : properties.pageSizes
                      .map(
                        (size) =>
                          `${String(size.width)} × ${String(size.height)} pt (${String(size.pageCount)} page${size.pageCount === 1 ? '' : 's'})`,
                      )
                      .join(', ')}
              </dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factTerm}>Tagged PDF</dt>
              <dd className={styles.factValue}>{properties.tagged ? 'Yes' : 'No'}</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factTerm}>Fast web view</dt>
              <dd className={styles.factValue}>{properties.linearized ? 'Yes' : 'No'}</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factTerm}>XMP metadata</dt>
              <dd className={styles.factValue}>{properties.hasXmpMetadata ? 'Present' : 'None'}</dd>
            </div>
          </dl>
        )}
      </div>
    </Dialog>
  );
}
