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

async function fetchLectures(studentId?: string): Promise<Lecture[]> {
  const qs = studentId ? `?student_id=${encodeURIComponent(studentId)}` : '';
  const res = await apiFetch(`/api/v1/lectures${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch lectures: ${res.status}`);
  return res.json();
}

// studentId is optional — callers that only need lecture id/title/video_url
// (not the per-student `mastery` field) can omit it and get the server's
// default. Included in the query key so switching students (the instructor
// switcher) actually refetches instead of serving a stale student's cache.
export function useLectures(studentId?: string) {
  return useQuery({
    queryKey: ['lectures', studentId ?? null],
    queryFn: () => fetchLectures(studentId),
    staleTime: Infinity,
  });
}
