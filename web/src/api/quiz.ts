import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface QuizOption {
  id: string;
  text: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: QuizOption[];
  correct_option_id: string;
  concept_id: string | null;
  source_timestamp_ms: number;
  explanation: string | null;
}

// Matches gateway/app/routes/remediation.py's RemediationResponse exactly —
// R1's backward-traversal query, embedded directly in a wrong answer's
// response (POST /attempts) rather than requiring a second round-trip to
// GET /remediation.
export interface Remediation {
  found: boolean;
  concept: { id: string; label: string } | null;
  target: { lecture_id: string; lecture_title: string; timestamp_ms: number; duration_hint_ms: number } | null;
  hops: number | null;
  reason: string | null;
}

export interface AttemptResult {
  correct: boolean;
  remediation: Remediation | null;
}

// D3 (Stage 8) — due reviews (SM-2-lite), same shape as QuizQuestion plus
// which lecture it's from and when it came due, since the drill spans the
// whole course rather than one lecture's own context.
export interface DueQuestion {
  question_id: string;
  due_at: string;
  lecture_id: string;
  lecture_title: string;
  prompt: string;
  options: QuizOption[];
  correct_option_id: string;
  explanation: string | null;
  source_timestamp_ms: number;
}

async function fetchQuiz(lectureId: string): Promise<QuizQuestion[]> {
  const res = await fetch(`/api/v1/lectures/${lectureId}/quiz`);
  if (!res.ok) throw new Error(`Failed to fetch quiz: ${res.status}`);
  return res.json();
}

export function useQuiz(lectureId: string) {
  return useQuery({
    queryKey: ['quiz', lectureId],
    queryFn: () => fetchQuiz(lectureId),
    staleTime: Infinity, // approval status only changes via the instructor review queue (X4)
  });
}

async function fetchDueQuestions(studentId: string): Promise<DueQuestion[]> {
  const res = await fetch(`/api/v1/schedule?student_id=${studentId}`);
  if (!res.ok) throw new Error(`Failed to fetch schedule: ${res.status}`);
  return res.json();
}

export function useDueQuestions(studentId: string) {
  return useQuery({
    queryKey: ['schedule', studentId],
    queryFn: () => fetchDueQuestions(studentId),
  });
}

interface AttemptArgs {
  questionId: string;
  chosenOptionId: string;
  studentId: string;
}

async function submitAttempt({ questionId, chosenOptionId, studentId }: AttemptArgs): Promise<AttemptResult> {
  const res = await fetch('/api/v1/attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_id: questionId, chosen_option_id: chosenOptionId, student_id: studentId }),
  });
  if (!res.ok) throw new Error(`Failed to submit attempt: ${res.status}`);
  return res.json();
}

export function useSubmitAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: submitAttempt,
    onSuccess: () => {
      // Mastery may have changed — P1's graph overlay (Stage 10) will read
      // this later; invalidating now keeps it correct once that lands.
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      // The answered question's due_at just moved (D3) — refetch so the
      // drill page doesn't keep offering something just answered.
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
  });
}
