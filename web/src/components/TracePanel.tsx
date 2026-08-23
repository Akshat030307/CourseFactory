import { useLatestJob } from '../api/jobs';
import { useJobTrace } from '../trace/useJobTrace';

export function TracePanel() {
  const { data: latestJob } = useLatestJob();
  const jobId = latestJob?.status === 'running' ? latestJob.id : null;
  const trace = useJobTrace(jobId);

  if (!latestJob) return <p className="text-[var(--dust)]">No ingestion jobs yet — run scripts/ingest.py to start one.</p>;

  if (latestJob.status !== 'running') {
    return (
      <div className="flex flex-col gap-[var(--s-1)]">
        <p className="text-[var(--dust)]">
          No job running. Last: {latestJob.lecture_id ?? '—'} ({latestJob.status}).
        </p>
        {/* Live trace.error (below) only exists while a WS connection was
            open when the job failed — easy to miss on a job that fails in
            ~1s (e.g. a YouTube download rejected before any real work
            starts). This is the same error, read back from the job row
            itself, so it's visible on a later page load too. */}
        {latestJob.status === 'failed' && latestJob.error && (
          <p className="text-[var(--error)]">{latestJob.error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--s-2)]">
      <div className="flex items-center justify-between">
        <p className="text-[var(--step--1)] text-[var(--dust)]">{latestJob.lecture_id}</p>
        {/* Dollars at 4dp rounds real per-lecture costs (a fraction of a
            cent — see CLAUDE.md's ~$0.015/lecture target) straight to
            "$0.0000", which isn't a useful cost meter even though the
            underlying number is correct. Cents at 4dp actually shows it. */}
        <p className="text-[var(--step--1)] text-[var(--path)]">{trace.costCents.toFixed(4)}¢</p>
      </div>
      <div className="flex max-h-64 flex-col gap-[var(--s-1)] overflow-y-auto">
        {trace.lines.length === 0 && <p className="text-[var(--step--1)] text-[var(--dust)]">Waiting for progress…</p>}
        {trace.lines.map((l) => (
          <div key={l.seq} className="flex gap-[var(--s-2)] text-[var(--step--1)]">
            <span className="ts w-10 shrink-0">{l.pct ?? 0}%</span>
            <span className="text-[var(--chalk)]">{l.message ?? l.stage}</span>
          </div>
        ))}
      </div>
      {trace.status === 'failed' && <p className="text-[var(--error)]">{trace.error}</p>}
    </div>
  );
}
