import { useCallback, useRef, useState } from 'react';
import { type Segment, useSegments } from '../api/segments';
import { type Contradiction, useContradictions } from '../api/contradictions';
import { useActiveContradiction } from '../contradictions/activeContradiction';
import { seekTo } from '../player/playerControls';
import { usePlayerTime } from '../player/usePlayerTime';

const CLAIM_MATCH_WINDOW_MS = 5000;

interface TranscriptLaneProps {
  lectureId: string;
  courseId?: string;
}

function findActiveId(ms: number, segments: Segment[]): string | null {
  let active: string | null = null;
  for (const seg of segments) {
    if (seg.start_ms > ms) break;
    active = seg.id;
  }
  return active;
}

export function TranscriptLane({ lectureId, courseId }: TranscriptLaneProps) {
  const { data: segments, isLoading, error } = useSegments(lectureId);
  const { data: contradictions } = useContradictions(courseId);
  const setActiveContradiction = useActiveContradiction((s) => s.setActive);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // X1 (Stage 9): "inline timeline markers" — a claim behind a detected
  // contradiction, if it falls in this lecture, gets a marker right on its
  // transcript line rather than only surfacing in a separate list.
  function contradictionFor(seg: Segment): Contradiction | undefined {
    return contradictions?.find((c) => {
      const a = c.claim_a.lecture_id === lectureId && Math.abs(c.claim_a.timestamp_ms - seg.start_ms) < CLAIM_MATCH_WINDOW_MS;
      const b = c.claim_b.lecture_id === lectureId && Math.abs(c.claim_b.timestamp_ms - seg.start_ms) < CLAIM_MATCH_WINDOW_MS;
      return a || b;
    });
  }

  const onTick = useCallback(
    (ms: number) => {
      if (!segments) return;
      const next = findActiveId(ms, segments);
      setActiveId((prev) => (prev === next ? prev : next));
      if (next) activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    [segments],
  );
  usePlayerTime(onTick);

  if (isLoading) return <p className="text-[var(--dust)]">Loading transcript…</p>;
  if (error) return <p className="text-[var(--error)]">Couldn't load the transcript. Try reloading.</p>;
  if (!segments?.length) return <p className="text-[var(--dust)]">No transcript yet — ingest this lecture with scripts/ingest.py.</p>;

  return (
    <div className="flex flex-col gap-[var(--s-1)]">
      {segments.map((seg) => {
        const isActive = seg.id === activeId;
        const contradiction = contradictionFor(seg);
        return (
          <div key={seg.id} className="flex items-center gap-[var(--s-1)]">
            <button
              ref={isActive ? activeRef : undefined}
              onClick={() => seekTo(lectureId, seg.start_ms)}
              title={seg.text}
              className={`flex min-w-0 flex-1 items-baseline gap-[var(--s-2)] rounded-[var(--radius)] px-[var(--s-2)] py-[var(--s-1)] text-left transition-colors ${
                isActive ? 'bg-[var(--path-dim)] text-[var(--chalk)]' : 'text-[var(--dust)] hover:bg-[var(--slate-line)]'
              }`}
            >
              <span className="ts shrink-0">{formatTimestamp(seg.start_ms)}</span>
              {/* Captions read as one line at a time, like real captions —
                  not a wrapped paragraph. Full text still reachable via the
                  title tooltip on hover for anything actually truncated. */}
              <span className="truncate">{seg.text}</span>
            </button>
            {contradiction && (
              <button
                onClick={() => setActiveContradiction(contradiction)}
                title={`Contradiction: ${contradiction.note ?? ''}`}
                className="shrink-0 rounded-full bg-[var(--error)]/20 px-[var(--s-1)] text-[var(--step--1)] text-[var(--error)]"
              >
                ⚠
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
