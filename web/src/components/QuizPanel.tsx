import { useState } from 'react';
import { useQuiz, useSubmitAttempt, type AttemptResult } from '../api/quiz';
import { seekTo } from '../player/playerControls';
import { RemediationCard } from './RemediationCard';

// Matches gateway/app/config.py's DEMO_STUDENT_ID default — one hardcoded
// student for this build, per CLAUDE.md.
const DEMO_STUDENT_ID = 's1';

interface QuizPanelProps {
  lectureId: string;
}

export function QuizPanel({ lectureId }: QuizPanelProps) {
  const { data: questions, isPending, isError } = useQuiz(lectureId);
  const submitAttempt = useSubmitAttempt();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);

  if (isPending) return <p className="text-[var(--dust)]">Loading quiz…</p>;
  if (isError) return <p className="text-[var(--error)]">Couldn't load the quiz. Try reloading.</p>;
  if (questions.length === 0) {
    return <p className="text-[var(--dust)]">No approved questions for this lecture yet.</p>;
  }

  if (index >= questions.length) {
    return (
      <div className="flex flex-col gap-[var(--s-2)]">
        <p className="text-[var(--ok)]">Quiz complete — {questions.length} question{questions.length === 1 ? '' : 's'}.</p>
        <button
          onClick={() => {
            setIndex(0);
            setSelected(null);
            setResult(null);
          }}
          className="self-start rounded-[var(--radius)] border border-[var(--slate-line)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--dust)] hover:text-[var(--chalk)]"
        >
          Retake
        </button>
      </div>
    );
  }

  const question = questions[index];
  // The one case R3 actually orchestrates: a wrong answer with somewhere
  // real to send the student. A wrong answer with no eligible prerequisite
  // gap (remediation.found === false) just falls through to plain feedback
  // — there's nothing honest to dim the question *for*.
  const hasRemediation = !!result && !result.correct && !!result.remediation?.found;

  function onSelect(optionId: string) {
    if (result) return; // already answered — Next advances instead
    setSelected(optionId);
  }

  function onSubmit() {
    if (!selected) return;
    submitAttempt.mutate(
      { questionId: question.id, chosenOptionId: selected, studentId: DEMO_STUDENT_ID },
      { onSuccess: (data) => setResult(data) },
    );
  }

  function onNext() {
    setIndex((i) => i + 1);
    setSelected(null);
    setResult(null);
  }

  return (
    <div className="flex flex-col gap-[var(--s-3)]">
      <p className="text-[var(--step--1)] text-[var(--dust)]">
        Question {index + 1} of {questions.length}
      </p>

      <div
        className="flex flex-col gap-[var(--s-3)] transition-opacity"
        style={{ opacity: hasRemediation ? 0.35 : 1, transitionDuration: 'var(--dur-remediation)' }}
      >
        <p className="text-[var(--chalk)]">{question.prompt}</p>

        <div className="flex flex-col gap-[var(--s-1)]">
          {question.options.map((opt) => {
            const isSelected = selected === opt.id;
            const isCorrectOption = result && opt.id === question.correct_option_id;
            const isWrongPick = result && isSelected && opt.id !== question.correct_option_id;
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
          onClick={onSubmit}
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
          {question.explanation && <p className="text-[var(--step--1)] text-[var(--chalk)]">{question.explanation}</p>}
          {result.correct && (
            <button
              onClick={() => seekTo(lectureId, question.source_timestamp_ms)}
              className="self-start text-[var(--step--1)] text-[var(--path)] underline underline-offset-2"
            >
              Jump to this moment
            </button>
          )}
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
}
