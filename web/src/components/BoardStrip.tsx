import { useCallback, useEffect, useRef, useState } from 'react';
import { type Frame, useFrames } from '../api/frames';
import { useSegments } from '../api/segments';
import { isPlaying, seekTo } from '../player/playerControls';
import { usePlayerTime } from '../player/usePlayerTime';
import { snapToSegment } from '../player/snapToSegment';
import { useSearchHighlights } from '../search/searchHighlights';

interface BoardStripProps {
  lectureId: string;
}

function findActiveIndex(ms: number, frames: Frame[]): number {
  let active = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].timestamp_ms > ms) break;
    active = i;
  }
  return active;
}

// Horizontal strip of deduped board states — the signature element (B5).
// Not virtualised with a windowing library: at fixture scale (dozens of
// frames per lecture) rendering them all costs nothing, and the real
// "windowed by time" behavior — the from_ms/to_ms params on GET
// /lectures/{id}/frames — is already there for when a course has thousands.
export function BoardStrip({ lectureId }: BoardStripProps) {
  const { data: frames, isLoading, error } = useFrames(lectureId);
  const { data: segments } = useSegments(lectureId);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const highlightedIds = useSearchHighlights((s) => s.frameIds);

  const onTick = useCallback(
    (ms: number) => {
      if (!frames) return;
      setActiveIndex((prev) => {
        // Ignore ticks that only fired because a seek just landed (e.g.
        // stepTo's snapToSegment pre-roll puts the playhead before the
        // frame it targeted) — those aren't real playback progress and
        // would fight with deliberate navigation. The very first call
        // (prev === -1, nothing set yet) always applies, so the frame
        // covering t=0 still shows active immediately on load.
        if (prev !== -1 && !isPlaying()) return prev;
        const next = findActiveIndex(ms, frames);
        return prev === next ? prev : next;
      });
    },
    [frames],
  );
  usePlayerTime(onTick);

  const stepTo = useCallback(
    (index: number) => {
      if (!frames || index < 0 || index >= frames.length) return;
      const ms = frames[index].timestamp_ms;
      seekTo(lectureId, segments ? snapToSegment(ms, segments) : ms);
      // snapToSegment backs up to 1500ms of pre-roll, landing before the
      // frame's own timestamp — time-based tracking (onTick) would never see
      // us as "arrived" on a paused video, so arrow keys would re-seek to
      // the same spot forever. Set it directly for deliberate navigation.
      setActiveIndex(index);
    },
    [frames, segments, lectureId],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepTo(activeIndex + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepTo(Math.max(0, activeIndex - 1));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, stepTo]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  const firstHighlightRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (highlightedIds.size > 0) {
      firstHighlightRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }, [highlightedIds]);

  if (isLoading) return <p className="text-[var(--dust)]">Loading board states…</p>;
  if (error) return <p className="text-[var(--error)]">Couldn't load board states. Try reloading.</p>;
  if (!frames?.length) return null;

  const hoveredFrame = frames.find((f) => f.id === hoveredId);
  const hoverText = hoveredFrame && (hoveredFrame.vision_description || hoveredFrame.ocr_text);
  const firstHighlightIndex = frames.findIndex((f) => highlightedIds.has(f.id));

  return (
    <div>
      <div className="flex gap-[var(--s-2)] overflow-x-auto pb-[var(--s-2)]">
        {frames.map((frame, i) => {
          const isActive = i === activeIndex;
          const isHighlighted = highlightedIds.has(frame.id);
          return (
            <button
              key={frame.id}
              ref={(el) => {
                if (isActive) activeRef.current = el;
                if (i === firstHighlightIndex) firstHighlightRef.current = el;
              }}
              onClick={() => stepTo(i)}
              onMouseEnter={() => setHoveredId(frame.id)}
              onMouseLeave={() => setHoveredId((id) => (id === frame.id ? null : id))}
              className={`block h-16 w-28 shrink-0 overflow-hidden rounded-[var(--radius)] border-2 bg-black transition-colors ${
                isActive
                  ? 'border-[var(--path)]'
                  : isHighlighted
                    ? 'border-[var(--written)]'
                    : 'border-transparent hover:border-[var(--slate-line)]'
              }`}
            >
              <img src={frame.thumb_url} alt="" className="h-full w-full object-cover" />
            </button>
          );
        })}
      </div>
      {/* A fixed panel below the strip, not a per-thumbnail floating tooltip —
          the strip needs overflow-x-auto to scroll, which (per the CSS spec)
          computes overflow-y to auto too, silently clipping anything
          positioned outside a thumbnail's own box, tooltips included. */}
      {hoveredFrame && hoverText && (
        <div
          className={`mt-[var(--s-2)] rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-2)] text-[var(--step--1)] ${
            hoveredFrame.spoken_elsewhere ? 'text-[var(--chalk)]' : 'written'
          }`}
        >
          {hoverText}
          {!hoveredFrame.spoken_elsewhere && (
            <div className="mt-[var(--s-1)] text-[var(--written)]">Never said out loud</div>
          )}
        </div>
      )}
    </div>
  );
}
