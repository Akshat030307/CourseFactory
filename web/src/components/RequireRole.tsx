import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from '../api/auth';
import { useCourses } from '../api/lectures';

// Parallel to RequireAuth, not a prop on it — Upload/Review Queue/Waitlist
// are instructor-only tools with no student-facing reason to exist (the
// gateway enforces this too, see app/auth.py's require_instructor; this is
// the UI-side mirror so a student doesn't even see a route that would
// 403). A non-matching role redirects into the shared course view rather
// than back to /login — they ARE authenticated, just not authorized here.
export function RequireRole({ role, children }: { role: 'instructor' | 'student'; children: ReactNode }) {
  const { data, isPending } = useMe();
  const { data: courses } = useCourses();
  const firstCourseId = courses?.[0]?.id ?? '18.06';

  if (isPending) return null;
  if (!data?.authenticated) return <Navigate to="/login" replace />;
  if (data.role !== role) return <Navigate to={`/course/${firstCourseId}`} replace />;
  return <>{children}</>;
}
