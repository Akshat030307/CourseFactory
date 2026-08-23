import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './http';

export interface Lecture {
  id: string;
  title: string;
  course_id: string;
  sequence: number;
  duration_ms: number | null;
  status: string;
  video_url: string;
  mastery: number | null;
}

export interface Course {
  id: string;
  title: string;
}

async function fetchCourses(): Promise<Course[]> {
  const res = await apiFetch('/api/v1/courses');
  if (!res.ok) throw new Error(`Failed to fetch courses: ${res.status}`);
  return res.json();
}

export function useCourses() {
  return useQuery({
    queryKey: ['courses'],
    queryFn: fetchCourses,
    staleTime: Infinity,
  });
}

async function fetchLectures(courseId?: string, studentId?: string): Promise<Lecture[]> {
  const params = new URLSearchParams();
  if (courseId) params.set('course_id', courseId);
  if (studentId) params.set('student_id', studentId);
  const qs = params.toString();
  const res = await apiFetch(`/api/v1/lectures${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Failed to fetch lectures: ${res.status}`);
  return res.json();
}

// Options object, not two positional strings — a positional courseId/
// studentId pair is exactly the shape that silently swapped slots once
// already (GraphPanel.tsx used to call useLectures(studentId) alone before
// courseId existed; adding a new leading positional param here would have
// broken that call without a type error). Both are optional — callers that
// only need lecture id/title/video_url can omit either and get the
// server's default. Both are in the query key so switching course or
// student (the course/instructor switchers) actually refetches instead of
// serving a stale selection's cache.
export function useLectures(opts: { courseId?: string; studentId?: string } = {}) {
  const { courseId, studentId } = opts;
  return useQuery({
    queryKey: ['lectures', courseId ?? null, studentId ?? null],
    queryFn: () => fetchLectures(courseId, studentId),
    staleTime: Infinity,
  });
}
