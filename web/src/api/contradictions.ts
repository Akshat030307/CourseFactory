import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './http';

export interface Claim {
  lecture_id: string;
  timestamp_ms: number;
  text: string;
}

export interface Contradiction {
  id: string;
  confidence: number;
  claim_a: Claim;
  claim_b: Claim;
  note: string | null;
}

async function fetchContradictions(courseId: string): Promise<Contradiction[]> {
  const res = await apiFetch(`/api/v1/courses/${courseId}/contradictions`);
  if (!res.ok) throw new Error(`Failed to fetch contradictions: ${res.status}`);
  return res.json();
}

export function useContradictions(courseId: string) {
  return useQuery({
    queryKey: ['contradictions', courseId],
    queryFn: () => fetchContradictions(courseId),
  });
}
