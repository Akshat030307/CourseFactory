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

async function fetchLectures(): Promise<Lecture[]> {
  const res = await apiFetch('/api/v1/lectures');
  if (!res.ok) throw new Error(`Failed to fetch lectures: ${res.status}`);
  return res.json();
}

export function useLectures() {
  return useQuery({
    queryKey: ['lectures'],
    queryFn: fetchLectures,
    staleTime: Infinity,
  });
}
