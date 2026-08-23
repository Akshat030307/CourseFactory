import { Link } from 'react-router-dom';
import { useApproveByConcept, useApproveQuestion, useRejectQuestion, useReviewQueue, type ReviewItem } from '../api/reviewQueue';
import { LogoutButton } from './AppShell';

// X4 (Stage 9): instructor-facing, not student-facing — CLAUDE.md: "one
// hardcoded student, one instructor," no auth to gate this behind, so it's
// just its own route rather than folded into AppShell's student view.
const COURSE_ID = '18.06';

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
}

export function ReviewQueuePage() {
  const { data: items, isPending, isError } = useReviewQueue(COURSE_ID);
  const approveQuestion = useApproveQuestion();
  const rejectQuestion = useRejectQuestion();
  const approveByConcept = useApproveByConcept();

  const groups = new Map<string, { label: string; items: ReviewItem[] }>();
  for (const item of items ?? []) {
    const key = item.concept_id ?? item.id;
    const group = groups.get(key) ?? { label: item.concept_label ?? '(no concept)', items: [] };
    group.items.push(item);
    groups.set(key, group);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-[var(--s-4)] p-[var(--s-5)]">
      <div className="flex items-center justify-between">
        <h1 className="font-[var(--font-display)] text-[var(--step-2)] text-[var(--chalk)]">Review queue</h1>
        <div className="flex items-center gap-[var(--s-3)]">
          <Link to="/lecture/l01" className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
            Back to course
          </Link>
          <LogoutButton />
        </div>
      </div>

      {isPending && <p className="text-[var(--dust)]">Loading…</p>}
      {isError && <p className="text-[var(--error)]">Couldn't load the review queue. Try reloading.</p>}
      {items && items.length === 0 && <p className="text-[var(--dust)]">Nothing waiting for review.</p>}

      {[...groups.entries()].map(([conceptId, group]) => (
        <section key={conceptId} className="flex flex-col gap-[var(--s-3)] rounded-[var(--radius)] border border-[var(--slate-line)] p-[var(--s-3)]">
          <div className="flex items-center justify-between">
            <h2 className="text-[var(--step-0)] text-[var(--chalk)]">
              {group.label} <span className="text-[var(--dust)]">({group.items.length})</span>
            </h2>
            {group.items.length > 1 && (
              <button
                onClick={() => approveByConcept.mutate(conceptId)}
                disabled={approveByConcept.isPending}
                className="rounded-[var(--radius)] bg-[var(--ok)]/20 px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--ok)] disabled:opacity-50"
              >
                Approve all {group.items.length}
              </button>
            )}
          </div>

          {group.items.map((item) => (
            <div key={item.id} className="flex gap-[var(--s-3)] rounded-[var(--radius)] bg-[var(--slate-raised)] p-[var(--s-2)]">
              {item.frame_thumb_url && (
                <img src={item.frame_thumb_url} alt="" className="h-20 w-32 shrink-0 rounded-[var(--radius)] object-cover" />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-[var(--s-1)]">
                <div className="ts">
                  {item.lecture_title} · {formatTimestamp(item.source_timestamp_ms)}
                </div>
                {item.segment_text && <p className="text-[var(--step--1)] text-[var(--dust)] italic">"{item.segment_text}"</p>}
                <p className="text-[var(--chalk)]">{item.prompt}</p>
                <ul className="flex flex-col gap-[var(--s-1)]">
                  {item.options.map((opt) => (
                    <li
                      key={opt.id}
                      className={`rounded-[var(--radius)] border px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] ${
                        opt.id === item.correct_option_id
                          ? 'border-[var(--ok)] bg-[var(--ok)]/10 text-[var(--chalk)]'
                          : 'border-[var(--slate-line)] text-[var(--dust)]'
                      }`}
                    >
                      {opt.text}
                    </li>
                  ))}
                </ul>
                {item.explanation && <p className="text-[var(--step--1)] text-[var(--dust)]">{item.explanation}</p>}
                <div className="flex gap-[var(--s-2)]">
                  <button
                    onClick={() => approveQuestion.mutate(item.id)}
                    disabled={approveQuestion.isPending}
                    className="rounded-[var(--radius)] bg-[var(--ok)]/20 px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--ok)] disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectQuestion.mutate(item.id)}
                    disabled={rejectQuestion.isPending}
                    className="rounded-[var(--radius)] bg-[var(--error)]/20 px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--error)] disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
