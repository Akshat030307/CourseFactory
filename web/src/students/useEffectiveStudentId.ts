import { useMe } from '../api/auth';
import { useSelectedStudent } from './selectedStudent';

// Replaces the old hardcoded `const DEMO_STUDENT_ID = 's1'` literals in
// QuizPanel.tsx/DrillPage.tsx. A student session always gets their own id
// (the server enforces this anyway — see gateway/app/auth.py's
// resolve_student_id — but resolving it correctly client-side means the
// UI shows the right data instead of just being overridden after the
// fact). An instructor session gets whatever they've picked in the
// AppShell switcher, or undefined (server default) if nothing's picked
// yet.
export function useEffectiveStudentId(): string | undefined {
  const { data: me } = useMe();
  const selected = useSelectedStudent((s) => s.studentId);

  if (me?.role === 'student' && me.student_id) return me.student_id;
  return selected ?? undefined;
}
