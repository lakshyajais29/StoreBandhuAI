import { useEffect, useState } from 'react';
import type { Api } from '../api';
import type { JobView } from '../types';
import { STATUS_LABEL } from '../format';

export function JobCard({ job: initial, api, onSettled }: { job: JobView; api: Api; onSettled: () => void }) {
  const [job, setJob] = useState(initial);
  useEffect(() => {
    if (job.status === 'succeeded' || job.status === 'failed') return;
    const t = setInterval(async () => {
      try {
        const next = await api.job(job.id);
        setJob(next);
        if (next.status === 'succeeded' || next.status === 'failed') { clearInterval(t); onSettled(); }
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
  }, [job.id, job.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = job.status === 'queued' || job.status === 'running';
  return (
    <article className={`job job--${job.status}`}>
      <div className="job-media">
        {job.status === 'succeeded' && job.resultUrl
          ? (job.kind === 'video' && job.resultUrl.endsWith('.mp4')
            ? <video src={job.resultUrl} controls playsInline />
            : <img src={job.resultUrl} alt={`Generated ${job.kind}`} />)
          : <div className={pending ? 'job-wait' : 'job-empty'} aria-hidden="true" />}
      </div>
      <div className="job-meta">
        <strong>{job.kind === 'video' ? 'Product video' : 'Product photo'}{job.style ? ` · ${job.style.replace('_', ' ')}` : ''}</strong>
        <span>{STATUS_LABEL[job.status]}{job.status === 'succeeded' ? ` · ${job.tokenCost} tokens` : ''}</span>
        {job.error && <span className="warn">{job.error.message}</span>}
        {job.status === 'succeeded' && job.resultUrl && <a href={job.resultUrl} target="_blank" rel="noreferrer" download>Download</a>}
      </div>
    </article>
  );
}
