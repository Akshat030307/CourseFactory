import { useEffect, useRef, useState } from 'react';
import { type Lane, useSearch } from '../api/search';
import { navigate } from '../nav/navigate';
import { useSearchHighlights } from '../search/searchHighlights';

const LANES: { value: Lane; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'spoken', label: 'Spoken' },
  { value: 'written', label: 'Written' },
];

export function SearchPanel({ courseId }: { courseId?: string }) {
  const [query, setQuery] = useState('');
  const [lane, setLane] = useState<Lane>('both');
  const search = useSearch();
  const setHighlights = useSearchHighlights((s) => s.setHighlights);
  const clearHighlights = useSearchHighlights((s) => s.clear);
  const inputRef = useRef<HTMLInputElement>(null);

  // P3: "/" focuses search, from anywhere in the app that isn't already a
  // text input — same target-tag guard BoardStrip's own arrow-key handler
  // (B5) already uses, so typing a literal "/" into another field still works.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || !courseId) return;
    search.mutate(
      { query, lane, courseId },
      {
        onSuccess: (data) => {
          const boardFrameIds = data.results.filter((r) => r.source === 'board' && r.frame_id).map((r) => r.frame_id!);
          setHighlights(boardFrameIds);
        },
      },
    );
  }

  function onLaneChange(next: Lane) {
    setLane(next);
    clearHighlights();
  }

  const transcriptHits = search.data?.results.filter((r) => r.source === 'transcript') ?? [];
  const boardHits = search.data?.results.filter((r) => r.source === 'board') ?? [];
  const boardNeverSpokenCount = boardHits.filter((r) => r.spoken_elsewhere === false).length;

  return (
    <div className="flex flex-col gap-[var(--s-3)]">
      <form onSubmit={onSubmit} className="flex flex-col gap-[var(--s-2)]">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this course… (/)"
          className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--chalk)] placeholder:text-[var(--dust-faint)]"
        />
        <div className="flex gap-[var(--s-1)]">
          {LANES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onLaneChange(value)}
              className={`rounded-[var(--radius)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] transition-colors ${
                lane === value
                  ? 'bg-[var(--path-dim)] text-[var(--chalk)]'
                  : 'bg-[var(--slate)] text-[var(--dust)] hover:text-[var(--chalk)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </form>

      {search.isPending && <p className="text-[var(--dust)]">Searching…</p>}
      {search.isError && <p className="text-[var(--error)]">Search failed. Try again.</p>}

      {search.isSuccess && (
        <div className="flex flex-col gap-[var(--s-2)]">
          <p className="text-[var(--step--1)] text-[var(--dust)]">
            {search.data.results.length} result{search.data.results.length === 1 ? '' : 's'} · {search.data.took_ms}ms
          </p>

          {transcriptHits.map((hit) => (
            <button
              key={`${hit.lecture_id}-${hit.timestamp_ms}`}
              onClick={() => navigate(hit.lecture_id, hit.timestamp_ms, 'transcript')}
              className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-2)] text-left"
            >
              <div className="ts">
                {hit.lecture_title} · {formatTimestamp(hit.timestamp_ms)}
              </div>
              <div className="text-[var(--step--1)] text-[var(--chalk)]">{hit.snippet}</div>
            </button>
          ))}

          {/* Board-lane hits render in BoardStrip (via useSearchHighlights),
              not duplicated here as another list — see S3. */}
          {boardHits.length > 0 && (
            <p className="written text-[var(--step--1)]">
              {boardHits.length} board match{boardHits.length === 1 ? '' : 'es'}
              {boardNeverSpokenCount > 0 && ` (${boardNeverSpokenCount} never said out loud)`} — highlighted in the board strip
            </p>
          )}

          {search.data.results.length === 0 && <p className="text-[var(--dust)]">No matches. Try different words.</p>}
        </div>
      )}
    </div>
  );
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
