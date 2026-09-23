import { useMemo, useState, type ReactElement } from 'react';
import { Check, MessageSquare, Trash } from 'lucide-react';
import type { Annotation } from '@shared/schemas/annotation';
import { describeKind } from '@pdf/mutate/operations';
import { useDocumentStore } from '../../stores/documentStore';
import { useAnnotationStore, type CommentSort } from '../../stores/annotationStore';
import { cx } from '../../utils/classNames';
import { formatRelativeTime } from '../../utils/time';
import { IconButton } from '../controls/IconButton';
import { EmptyPanelState } from '../panels/EmptyPanelState';
import { arrangeComments, authorOf, authorsOf, TOOL_KINDS } from './annotationDrawing';
import styles from './CommentsPanel.module.css';

const SORTS: Array<{ id: CommentSort; label: string }> = [
  { id: 'page', label: 'Page' },
  { id: 'newest', label: 'Newest' },
  { id: 'author', label: 'Author' },
];

/**
 * Every comment in the document, in one list.
 *
 * The comments are read from the file, so a document marked up somewhere else
 * reads here just as well. Clicking one goes to it; the text can be edited in
 * place; and marking one as dealt with is PaperForge's own flag, which the
 * note under the list says plainly.
 */
export function CommentsPanel(): ReactElement {
  const annotations = useAnnotationStore((state) => state.annotations);
  const loading = useAnnotationStore((state) => state.loading);
  const selectedId = useAnnotationStore((state) => state.selectedId);
  const sort = useAnnotationStore((state) => state.sort);
  const filter = useAnnotationStore((state) => state.filter);
  const select = useAnnotationStore((state) => state.select);
  const setSort = useAnnotationStore((state) => state.setSort);
  const setFilter = useAnnotationStore((state) => state.setFilter);
  const remove = useAnnotationStore((state) => state.remove);
  const update = useAnnotationStore((state) => state.update);
  const updateView = useDocumentStore((state) => state.updateView);
  const activeId = useDocumentStore((state) => state.activeId);

  const shown = useMemo(
    () => arrangeComments(annotations, filter, sort),
    [annotations, filter, sort],
  );
  const authors = useMemo(() => authorsOf(annotations), [annotations]);
  const kinds = useMemo(
    () => TOOL_KINDS.filter((kind) => annotations.some((entry) => entry.geometry.kind === kind)),
    [annotations],
  );

  const goTo = (annotation: Annotation): void => {
    select(annotation.id);
    if (activeId !== null) updateView(activeId, { pendingPage: annotation.pageNumber });
  };

  if (loading && annotations.length === 0) {
    return <p className={styles.loading}>Reading the comments…</p>;
  }

  if (annotations.length === 0) {
    return (
      <EmptyPanelState
        icon={MessageSquare}
        title="No comments"
        description="Use the comment tools to highlight text, draw, or leave a note."
      />
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <label className={styles.control}>
          <span className={styles.controlLabel}>Sort</span>
          <select
            className={styles.select}
            value={sort}
            onChange={(event) => setSort(event.target.value as CommentSort)}
          >
            {SORTS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.control}>
          <span className={styles.controlLabel}>Type</span>
          <select
            className={styles.select}
            value={filter.kinds[0] ?? ''}
            onChange={(event) =>
              setFilter({ kinds: event.target.value === '' ? [] : [event.target.value as never] })
            }
          >
            <option value="">All</option>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {describeKind(kind)}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.control}>
          <span className={styles.controlLabel}>Author</span>
          <select
            className={styles.select}
            value={filter.authors[0] ?? ''}
            onChange={(event) =>
              setFilter({ authors: event.target.value === '' ? [] : [event.target.value] })
            }
          >
            <option value="">All</option>
            {authors.map((author) => (
              <option key={author} value={author}>
                {author}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.control}>
          <span className={styles.controlLabel}>Status</span>
          <select
            className={styles.select}
            value={filter.status}
            onChange={(event) => setFilter({ status: event.target.value as typeof filter.status })}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="resolved">Done</option>
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <p className={styles.loading}>No comment matches this filter.</p>
      ) : (
        <ul className={styles.list} aria-label="Comments">
          {shown.map((annotation) => (
            <CommentRow
              key={annotation.id}
              annotation={annotation}
              selected={annotation.id === selectedId}
              onOpen={() => goTo(annotation)}
              onDelete={() => void remove([annotation.id])}
              onToggleResolved={() =>
                void update(
                  annotation.id,
                  { resolved: !annotation.resolved },
                  annotation.resolved ? 'Reopen comment' : 'Mark comment done',
                )
              }
              onSaveText={(contents) =>
                void update(annotation.id, { contents }, 'Edit comment text')
              }
            />
          ))}
        </ul>
      )}

      <p className={styles.note}>
        Comments are stored in the PDF itself. “Done” is PaperForge&apos;s own mark: it comes back
        here, but other readers ignore it.
      </p>
    </div>
  );
}

interface CommentRowProps {
  annotation: Annotation;
  selected: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onToggleResolved: () => void;
  onSaveText: (contents: string) => void;
}

function CommentRow({
  annotation,
  selected,
  onOpen,
  onDelete,
  onToggleResolved,
  onSaveText,
}: CommentRowProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const when = annotation.modifiedAt ?? annotation.createdAt;

  return (
    <li className={cx(styles.item, selected && styles.selected)}>
      <button type="button" className={styles.head} onClick={onOpen}>
        <span className={styles.kind}>{describeKind(annotation.geometry.kind)}</span>
        <span className={styles.meta}>
          {authorOf(annotation)} · page {annotation.pageNumber}
          {when === null ? '' : ` · ${formatRelativeTime(when)}`}
        </span>
      </button>

      {draft === null ? (
        <button
          type="button"
          className={cx(styles.text, annotation.contents === '' && styles.empty)}
          title="Click to edit"
          onClick={() => setDraft(annotation.contents)}
        >
          {annotation.contents === '' ? 'Add a note…' : annotation.contents}
        </button>
      ) : (
        <textarea
          className={styles.editor}
          value={draft}
          autoFocus
          aria-label="Comment text"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft !== annotation.contents) onSaveText(draft);
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(null);
            }
          }}
        />
      )}

      <div className={styles.actions}>
        <IconButton
          icon={Check}
          label={annotation.resolved ? 'Reopen' : 'Mark as done'}
          size="small"
          pressed={annotation.resolved}
          onClick={onToggleResolved}
        />
        <IconButton icon={Trash} label="Delete comment" size="small" onClick={onDelete} />
      </div>
    </li>
  );
}
