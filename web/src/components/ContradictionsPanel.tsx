import { useContradictions } from '../api/contradictions';
import { useActiveContradiction } from '../contradictions/activeContradiction';

const COURSE_ID = '18.06';

export function ContradictionsPanel() {
  const { data: contradictions, isPending, isError } = useContradictions(COURSE_ID);
  const setActive = useActiveContradiction((s) => s.setActive);

  if (isPending) return <p className="text-[var(--dust)]">Loading…</p>;
  if (isError) return <p className="text-[var(--error)]">Couldn't load contradictions. Try reloading.</p>;
  if (contradictions.length === 0) return <p className="text-[var(--dust)]">None detected.</p>;

  return (
    <div className="flex flex-col gap-[var(--s-2)]">
      {contradictions.map((c) => (
        <button
          key={c.id}
          onClick={() => setActive(c)}
          className="rounded-[var(--radius)] border border-[var(--error)] bg-[var(--error)]/10 p-[var(--s-2)] text-left text-[var(--step--1)]"
        >
          <span className="text-[var(--error)]">{Math.round(c.confidence * 100)}% confidence</span>
          {c.note && <p className="mt-[var(--s-1)] text-[var(--chalk)]">{c.note}</p>}
        </button>
      ))}
    </div>
  );
}
