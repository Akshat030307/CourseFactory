import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDueQuestions, useSubmitAttempt, type AttemptResult, type DueQuestion } from '../api/quiz';
import { RemediationCard } from './RemediationCard';

// D3 (Stage 8): the in-app drill — due reviews across the whole course,
// same SM-2-lite schedule the Telegram bot (D2) reads from. Deliberately a
// simpler standalone page (no video player, no board strip): a review
// session isn't tied to watching one lecture, so it doesn't borrow
// AppShell's three-column layout.
const DEMO_STUDENT_ID = 's1';

export function DrillPage() {
  const { data: due, isPending, isError } = useDueQuestions(DEMO_STUDENT_ID);
  const submitAttempt = useSubmitAttempt();
  const [current, setCurrent] = useState<DueQuestion | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);

  // "Lock in" the active question rather than reading due[0] fresh every
  // render: submitting an attempt invalidates the schedule query (so the
  // drill offers something new next time), and that refetch was wiping the
  // just-answered question — and its result/remediation card — out from
  // under the student before they could read it. Only pick a new question
  // from `due` once `current` has been explicitly cleared (onNext).
  useEffect(() => {
    if (!current && due && due.length > 0) setCurrent(due[0]);
  }, [due, current]);

  const hasRemediation = !!result && !result.correct && !!result.remediation?.found;

  function onSelect(optionId: string) {
    if (result) return;
    setSelected(optionId);
  }

  function onSubmit(questionId: string) {
    if (!selected) return;
    submitAttempt.mutate(
      { questionId, chosenOptionId: selected, studentId: DEMO_STUDENT_ID },
      { onSuccess: (data) => setResult(data) },
    );
  }

  function onNext() {
    setCurrent(null);
    setSelected(null);
    setResult(null);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-[var(--s-4)] p-[var(--s-5)]">
      <div className="flex items-center justify-between">
        <h1 className="font-[var(--font-display)] text-[var(--step-2)] text-[var(--chalk)]">Review</h1>
        <Link to="/lecture/l01" className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
          Back to course
        </Link>
      </div>

      {isPending && <p className="text-[var(--dust)]">Loading…</p>}
      {isError && <p className="text-[var(--error)]">Couldn't load your review schedule. Try reloading.</p>}

      {/* current, not due — see the lock-in comment above. Once the last
          question is answered, `due` goes empty but `current` (and its
          result) stays visible until the student clicks Next/Skip. */}
      {due && due.length === 0 && !current && <p className="text-[var(--dust)]">Nothing due right now — check back later.</p>}

      {current && (
        <>
          <p className="text-[var(--step--1)] text-[var(--dust)]">
            {due?.length ?? 0} due for review
          </p>

          {(() => {
            const q = current;
            return (
              <div className="flex flex-col gap-[var(--s-3)]">
                <div
                  className="flex flex-col gap-[var(--s-3)] transition-opacity"
                  style={{ opacity: hasRemediation ? 0.35 : 1, transitionDuration: 'var(--dur-remediation)' }}
                >
                  <p className="text-[var(--step--1)] text-[var(--dust)]">{q.lecture_title}</p>
                  <p className="text-[var(--chalk)]">{q.prompt}</p>
                  <div className="flex flex-col gap-[var(--s-1)]">
                    {q.options.map((opt) => {
                      const isSelected = selected === opt.id;
                      const isCorrectOption = result && opt.id === q.correct_option_id;
                      const isWrongPick = result && isSelected && opt.id !== q.correct_option_id;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => onSelect(opt.id)}
                          disabled={!!result}
                          className={`rounded-[var(--radius)] border px-[var(--s-2)] py-[var(--s-1)] text-left text-[var(--step--1)] transition-colors ${
                            isCorrectOption
                              ? 'border-[var(--ok)] bg-[var(--ok)]/10 text-[var(--chalk)]'
                              : isWrongPick
                                ? 'border-[var(--error)] bg-[var(--error)]/10 text-[var(--chalk)]'
                                : isSelected
                                  ? 'border-[var(--path)] bg-[var(--path-dim)] text-[var(--chalk)]'
                                  : 'border-[var(--slate-line)] bg-[var(--slate)] text-[var(--dust)] hover:text-[var(--chalk)]'
                          }`}
                        >
                          {opt.text}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {!result && (
                  <button
                    onClick={() => onSubmit(q.question_id)}
                    disabled={!selected || submitAttempt.isPending}
                    className="self-start rounded-[var(--radius)] bg-[var(--path-dim)] px-[var(--s-3)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--chalk)] disabled:opacity-50"
                  >
                    {submitAttempt.isPending ? 'Submitting…' : 'Submit'}
                  </button>
                )}

                {result && hasRemediation && result.remediation && (
                  <>
                    <RemediationCard remediation={result.remediation} />
                    <button
                      onClick={onNext}
                      className="self-start rounded-[var(--radius)] border border-[var(--slate-line)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--dust)] hover:text-[var(--chalk)]"
                    >
                      Skip for now
                    </button>
                  </>
                )}

                {result && !hasRemediation && (
                  <div className="flex flex-col gap-[var(--s-2)] rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-2)]">
                    <p className={result.correct ? 'text-[var(--ok)]' : 'text-[var(--error)]'}>
                      {result.correct ? 'Correct.' : 'Not quite.'}
                    </p>
                    {q.explanation && <p className="text-[var(--step--1)] text-[var(--chalk)]">{q.explanation}</p>}
                    <button
                      onClick={onNext}
                      className="self-start rounded-[var(--radius)] border border-[var(--slate-line)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--dust)] hover:text-[var(--chalk)]"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
