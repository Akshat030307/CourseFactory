import { useMutation } from '@tanstack/react-query';

export type Lane = 'spoken' | 'written' | 'both';

export interface SearchResult {
  lecture_id: string;
  lecture_title: string;
  timestamp_ms: number;
  snippet: string;
  score: number;
  source: 'transcript' | 'board';
  spoken_elsewhere: boolean | null;
  frame_id: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  took_ms: number;
}

interface SearchArgs {
  query: string;
  lane: Lane;
  courseId: string;
  lectureId?: string;
}

async function runSearch({ query, lane, courseId, lectureId }: SearchArgs): Promise<SearchResponse> {
  const res = await fetch('/api/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, lane, course_id: courseId, lecture_id: lectureId ?? null, limit: 10 }),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

export function useSearch() {
  return useMutation({ mutationFn: runSearch });
}
