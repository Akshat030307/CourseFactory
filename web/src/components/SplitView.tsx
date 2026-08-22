import { useFrames, type Frame } from '../api/frames';
import { useLectures } from '../api/lectures';
import type { Claim, Contradiction } from '../api/contradictions';
import { useActiveContradiction } from '../contradictions/activeContradiction';
import { navigate } from '../nav/navigate';

// X1 (Stage 9): "clicking splits the stage to show both moments." A real
// second synchronized video player is a bigger architectural change than
// this ticket needs (playerControls.ts is a singleton-player registry) —
// two side-by-side moment cards (board frame + claim text + jump-there)
// show both moments just as clearly without it.
export function SplitView({ contradiction }: { contradiction: Contradiction }) {
  const clear = useActiveContradiction((s) => s.clear);

  return (
    <div className="flex h-full flex-col gap-[var(--s-4)]">
      <div className="flex items-center justify-between">
        <p className="text-[var(--step--1)] uppercase tracking-wide text-[var(--error)]">
          Contradiction · {Math.round(contradiction.confidence * 100)}% confidence
        </p>
        <button onClick={clear} className="text-[var(--step--1)] text-[var(--dust)] hover:text-[var(--chalk)]">
          Close
        </button>
      </div>
      {contradiction.note && <p className="text-[var(--chalk)]">{contradiction.note}</p>}
      <div className="grid flex-1 grid-cols-2 gap-[var(--s-4)]">
        <MomentCard claim={contradiction.claim_a} />
        <MomentCard claim={contradiction.claim_b} />
      </div>
    </div>
  );
}

function nearestFrame(frames: Frame[] | undefined, timestampMs: number): Frame | undefined {
  if (!frames?.length) return undefined;
  return frames.reduce((best, f) => (Math.abs(f.timestamp_ms - timestampMs) < Math.abs(best.timestamp_ms - timestampMs) ? f : best));
}

function MomentCard({ claim }: { claim: Claim }) {
  const { data: frames } = useFrames(claim.lecture_id);
  const { data: lectures } = useLectures();
  const frame = nearestFrame(frames, claim.timestamp_ms);
  const lectureTitle = lectures?.find((l) => l.id === claim.lecture_id)?.title ?? claim.lecture_id;

  return (
    <div className="flex flex-col gap-[var(--s-2)] rounded-[var(--radius-lg)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-3)]">
      <p className="ts">
        {lectureTitle} · {formatTimestamp(claim.timestamp_ms)}
      </p>
      {frame && <img src={frame.thumb_url} alt="" className="w-full rounded-[var(--radius)] object-cover" />}
      <p className="text-[var(--chalk)]">{claim.text}</p>
      <button
        onClick={() => navigate(claim.lecture_id, claim.timestamp_ms)}
        className="self-start rounded-[var(--radius)] bg-[var(--path-dim)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--chalk)]"
      >
        Go to this moment
      </button>
    </div>
  );
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
}
