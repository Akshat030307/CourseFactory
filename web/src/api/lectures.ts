import { useQuery } from '@tanstack/react-query';

export interface Lecture {
  id: string;
  title: string;
  course_id: string;
  sequence: number;
  duration_ms: number | null;
  status: string;
  mastery: number | null;
}

async function fetchLectures(): Promise<Lecture[]> {
  const res = await fetch('/api/v1/lectures');
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
