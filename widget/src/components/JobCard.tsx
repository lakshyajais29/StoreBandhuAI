import { useEffect, useState } from 'react';
import type { Api } from '../api';
import type { JobView } from '../types';
import { STATUS_LABEL } from '../format';

export function JobCard({ job: initial, api, onSettled }: { job: JobView; api: Api; onSettled: () => void }) {
  const [job, setJob] = useState(initial);
  const [retrying, setRetrying] = useState(false);
  const [retryErr, setRetryErr] = useState<string | null>(null);

  useEffect(() => { setJob(initial); }, [initial]);

  useEffect(() => {
    if (job.status === 'succeeded' || job.status === 'failed') return;
    const t = setInterval(async () => {
      try {
        const next = await api.job(job.id);
        setJob(next);
        if (next.status === 'succeeded' || next.status === 'failed') { clearInterval(t); onSettled(); }
      } catch { /* keep polling; a transient network blip shouldn't stop the poll */ }
    }, 4000);
    return () => clearInterval(t);
  }, [job.id, job.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = job.status === 'queued' || job.status === 'running';
  const canRetryAttach = job.status === 'succeeded' && job.attachStatus === 'failed' && !!job.productId;

  const retryAttach = async () => {
    setRetrying(true); setRetryErr(null);
    try {
      const next = await api.attachJob(job.id);
      setJob(next);
    } catch (e: any) {
      setRetryErr(e.message || 'Could not add this to the product.');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <article className={`job job--${job.status}`}>
      <div className="job-media">
        {job.status === 'succeeded' && job.resultUrl
          ? (job.kind === 'video' && job.resultUrl.endsWith('.mp4')
            ? <video src={job.resultUrl} controls playsInline preload="metadata" />
            : <img src={job.resultUrl} alt={`Generated ${job.kind}`} loading="lazy" />)
          : job.status === 'failed'
            ? <div className="job-failed" aria-hidden="true">⚠</div>
            : <div className="job-wait" aria-hidden="true" />}
      </div>
      <div className="job-meta">
        <strong>
          {job.kind === 'video' ? 'Product video' : 'Product photo'}
          {job.style ? ` · ${job.style.replace(/_/g, ' ')}` : ''}
        </strong>
        <span className={`job-state job-state--${job.status}`}>
          {pending && <span className="bill-spinner" aria-hidden="true" />}
          {STATUS_LABEL[job.status]}{job.status === 'succeeded' ? ` · ${job.tokenCost} tokens` : ''}
        </span>
        {job.error && <span className="warn">{job.error.message}</span>}

        {job.status === 'succeeded' && job.resultUrl && (
          <span className="job-links">
            <a href={job.resultUrl} target="_blank" rel="noreferrer" download>Download</a>
            {job.attachStatus === 'attached' && <span className="job-tag job-tag--ok">Added to product</span>}
            {canRetryAttach && (
              <button type="button" className="job-link-btn" disabled={retrying} onClick={retryAttach}>
                {retrying ? 'Adding…' : 'Add to product'}
              </button>
            )}
            {job.status === 'succeeded' && job.attachStatus === 'not_requested' && (
              <span className="muted job-hint">Mention the product next time to add it automatically.</span>
            )}
          </span>
        )}
        {retryErr && <span className="warn">{retryErr}</span>}
      </div>
    </article>
  );
}
