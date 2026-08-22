import { useQuery } from '@tanstack/react-query';

export interface Segment {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker: string | null;
}

async function fetchSegments(lectureId: string): Promise<Segment[]> {
  const res = await fetch(`/api/v1/lectures/${lectureId}/segments`);
  if (!res.ok) throw new Error(`Failed to fetch segments: ${res.status}`);
  return res.json();
}

export function useSegments(lectureId: string) {
  return useQuery({
    queryKey: ['segments', lectureId],
    queryFn: () => fetchSegments(lectureId),
    staleTime: Infinity, // immutable once ready — see docs/API.md
  });
}
