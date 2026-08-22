import { useNavStack } from '../nav/navStack';
import { returnToOrigin } from '../nav/navigate';
import { useLectures } from '../api/lectures';

// Persistent while the nav stack is non-empty — CLAUDE.md rule 6: "without
// returnToOrigin() they're stranded and the flow dies." Full R3 treatment
// (dimming, orchestrated transition) is its own ticket; this is just the
// part that keeps a cross-lecture navigate() from being a dead end.
export function ReturnPill() {
  const stack = useNavStack((s) => s.stack);
  const { data: lectures } = useLectures();
  if (stack.length === 0) return null;

  const origin = stack[stack.length - 1];
  const title = lectures?.find((l) => l.id === origin.lectureId)?.title ?? origin.lectureId;

  return (
    <button
      onClick={returnToOrigin}
      className="fixed bottom-[var(--s-4)] left-1/2 z-50 -translate-x-1/2 rounded-full border border-[var(--path)] bg-[var(--slate-raised)] px-[var(--s-4)] py-[var(--s-2)] text-[var(--step--1)] text-[var(--chalk)] shadow-lg hover:bg-[var(--path-dim)]"
    >
      ← Back to {title}
    </button>
  );
}
