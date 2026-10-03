import type { ReactElement } from 'react';
import { Activity, X } from 'lucide-react';
import { useJobStore } from '../../stores/jobStore';
import { useUiStore } from '../../stores/uiStore';
import { isJobActive, jobProgress, type Job } from '../../types/jobs';
import { IconButton } from '../controls/IconButton';
import { Button } from '../controls/Button';
import styles from './ProgressCenter.module.css';

function JobRow({ job }: { job: Job }): ReactElement {
  const cancel = useJobStore((state) => state.cancel);
  const dismiss = useJobStore((state) => state.dismiss);
  const percent = jobProgress(job);

  return (
    <li className={styles.job}>
      <div className={styles.jobHead}>
        <span className={styles.jobTitle}>{job.title}</span>
        <span className={styles.jobState}>{job.state}</span>
      </div>
      {job.currentItem !== undefined && <p className={styles.jobItem}>{job.currentItem}</p>}
      {isJobActive(job) && (
        <div
          className={styles.track}
          role="progressbar"
          aria-label={job.title}
          {...(percent === null
            ? {}
            : { 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100 })}
        >
          <div
            className={percent === null ? styles.barIndeterminate : styles.bar}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      )}
      {job.error !== undefined && <p className={styles.jobError}>{job.error}</p>}
      <div className={styles.jobActions}>
        {isJobActive(job) && job.cancellable && (
          <Button onClick={() => cancel(job.id)}>Cancel</Button>
        )}
        {!isJobActive(job) && <Button onClick={() => dismiss(job.id)}>Dismiss</Button>}
      </div>
    </li>
  );
}

/**
 * One place to watch long operations — recognising text, exporting, combining,
 * comparing, optimising, printing — and to stop the ones that can be stopped.
 */
export function ProgressCenter(): ReactElement {
  const jobs = useJobStore((state) => state.jobs);
  const dismissFinished = useJobStore((state) => state.dismissFinished);
  const close = useUiStore((state) => state.setProgressCenterOpen);
  const finishedCount = jobs.filter((job) => !isJobActive(job)).length;

  return (
    <div className={styles.popover} role="dialog" aria-label="Background tasks">
      <header className={styles.header}>
        <h2 className={styles.title}>Background tasks</h2>
        <IconButton icon={X} label="Close" size="small" onClick={() => close(false)} />
      </header>

      {jobs.length === 0 ? (
        <div className={styles.empty}>
          <Activity className={styles.emptyIcon} aria-hidden="true" strokeWidth={1.25} />
          <p className={styles.emptyTitle}>Nothing running</p>
          <p className={styles.emptyText}>
            Long operations such as text recognition and export report their progress here.
          </p>
        </div>
      ) : (
        <>
          <ul className={styles.list}>
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
          {finishedCount > 0 && (
            <footer className={styles.footer}>
              <Button onClick={dismissFinished}>Clear finished</Button>
            </footer>
          )}
        </>
      )}
    </div>
  );
}
