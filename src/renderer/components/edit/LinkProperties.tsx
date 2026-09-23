import { useState, type ReactElement } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { linkUrlSchema, type LinkModel } from '@shared/schemas/link';
import { Button } from '../controls/Button';
import { useDocumentStore } from '../../stores/documentStore';
import { linksFor, useLinkEditStore } from '../../stores/linkEditStore';
import styles from './EditProperties.module.css';

/**
 * Where the selected link goes, and where else it could go.
 *
 * PaperForge writes two kinds of destination: a page of this document, and a
 * web or mail address. A link that carries something else — a named
 * destination, a launch action, document JavaScript — is described as it is
 * and left alone unless the reader chooses to point it somewhere new.
 */
export function LinkProperties(): ReactElement {
  const selected = useLinkEditStore((store) => store.selected);
  const pages = useLinkEditStore((store) => store.pages);
  const drawing = useLinkEditStore((store) => store.drawing);
  const busy = useLinkEditStore((store) => store.busy);
  const sessionId = useDocumentStore((store) => store.activeId);
  const pageCount = useDocumentStore(
    (store) => store.tabs.find((tab) => tab.session.id === store.activeId)?.pageCount ?? 1,
  );

  const link =
    selected === null || sessionId === null
      ? undefined
      : linksFor(pages, sessionId, selected.page).find((entry) => entry.id === selected.id);

  // What has been typed, and which link it was typed for: the fields follow
  // whatever is selected rather than keeping what belonged to another link.
  const [typed, setTyped] = useState<Draft | null>(null);
  const form = link === undefined ? null : typed?.id === link.id ? typed : draftOf(link);

  if (selected === null || link === undefined) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>
          {drawing
            ? 'Drag on the page to draw the area the link should cover.'
            : 'Click a link on the page to move it or to change where it goes. Add link draws a new one.'}
        </p>
      </div>
    );
  }

  const { kind, page, url } = form ?? { kind: 'page' as const, page: 1, url: '' };
  const change = (patch: Partial<Draft>): void =>
    setTyped({ ...(form ?? draftOf(link)), ...patch });
  const address = linkUrlSchema.safeParse(url);
  const apply = (): void => {
    void useLinkEditStore.getState().update(selected.page, selected.id, {
      target:
        kind === 'url' && address.success
          ? { kind: 'url', url: address.data }
          : { kind: 'page', page: Math.max(1, Math.min(pageCount, page)) },
    });
  };

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>Link</h3>
        <p className={styles.sample}>{describe(link)}</p>
      </header>

      <dl className={styles.list}>
        <div className={styles.row}>
          <dt className={styles.label}>Area</dt>
          <dd className={styles.value}>
            {`${round(link.rect.width)} × ${round(link.rect.height)} pt`}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Position</dt>
          <dd className={styles.value}>{`${round(link.rect.x)}, ${round(link.rect.y)}`}</dd>
        </div>
        {link.added && (
          <div className={styles.row}>
            <dt className={styles.label}>Added</dt>
            <dd className={styles.value}>By PaperForge</dd>
          </div>
        )}
      </dl>

      <section className={styles.group}>
        <h3 className={styles.title}>Goes to</h3>
        <div className={styles.toggles}>
          <label className={styles.toggle}>
            <input
              type="radio"
              name="link-target"
              checked={kind === 'page'}
              onChange={() => change({ kind: 'page' })}
            />
            A page
          </label>
          <label className={styles.toggle}>
            <input
              type="radio"
              name="link-target"
              checked={kind === 'url'}
              onChange={() => change({ kind: 'url' })}
            />
            A web address
          </label>
        </div>

        {kind === 'page' ? (
          <div className={styles.row}>
            <label className={styles.label} htmlFor="link-page">
              Page
            </label>
            <input
              id="link-page"
              className={styles.number}
              type="number"
              min={1}
              max={pageCount}
              value={page}
              onChange={(event) => change({ page: Number(event.target.value) || 1 })}
            />
          </div>
        ) : (
          <label className={styles.cropField}>
            Address
            <input
              className={styles.select}
              type="url"
              value={url}
              placeholder="https://example.org"
              aria-label="Web address"
              onChange={(event) => change({ url: event.target.value })}
            />
          </label>
        )}

        {kind === 'url' && url !== '' && !address.success && (
          <p className={styles.warning}>
            A link can go to an http://, https:// or mailto: address. Anything else is not written.
          </p>
        )}

        <div className={styles.actions}>
          <Button
            appearance="primary"
            icon={Check}
            disabled={busy || (kind === 'url' && !address.success)}
            onClick={apply}
          >
            Apply
          </Button>
          <Button
            icon={Trash2}
            disabled={busy}
            onClick={() => void useLinkEditStore.getState().remove(selected.page, selected.id)}
          >
            Delete
          </Button>
        </div>
      </section>
    </div>
  );
}

/** The fields as they stand, and the link they belong to. */
interface Draft {
  id: string;
  kind: 'page' | 'url';
  page: number;
  url: string;
}

function draftOf(link: LinkModel): Draft {
  return {
    id: link.id,
    kind: link.target.kind === 'url' ? 'url' : 'page',
    page: link.target.kind === 'page' ? link.target.page : 1,
    url: link.target.kind === 'url' ? link.target.url : '',
  };
}

function describe(link: LinkModel): string {
  if (link.target.kind === 'url') return link.target.url;
  if (link.target.kind === 'page') return `Page ${String(link.target.page)} of this document`;
  return link.target.description;
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
