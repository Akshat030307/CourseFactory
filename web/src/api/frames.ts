import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './http';

export interface Frame {
  id: string;
  timestamp_ms: number;
  thumb_url: string;
  ocr_text: string | null;
  ocr_confidence: number | null;
  vision_description: string | null;
  spoken_elsewhere: boolean;
}

async function fetchFrames(lectureId: string): Promise<Frame[]> {
  const res = await apiFetch(`/api/v1/lectures/${lectureId}/frames`);
  if (!res.ok) throw new Error(`Failed to fetch frames: ${res.status}`);
  return res.json();
}

export function useFrames(lectureId: string) {
  return useQuery({
    queryKey: ['frames', lectureId],
    queryFn: () => fetchFrames(lectureId),
    staleTime: Infinity, // immutable once ready — same as segments
  });
}
