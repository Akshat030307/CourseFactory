import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './http';
import type { QuizOption } from './quiz';

export interface ReviewItem {
  id: string;
  lecture_id: string;
  lecture_title: string;
  concept_id: string | null;
  concept_label: string | null;
  prompt: string;
  options: QuizOption[];
  correct_option_id: string;
  explanation: string | null;
  source_timestamp_ms: number;
  segment_text: string | null;
  frame_id: string | null;
  frame_thumb_url: string | null;
}

async function fetchReviewQueue(courseId: string): Promise<ReviewItem[]> {
  const res = await apiFetch(`/api/v1/review-queue?course_id=${courseId}`);
  if (!res.ok) throw new Error(`Failed to fetch review queue: ${res.status}`);
  return res.json();
}

export function useReviewQueue(courseId: string) {
  return useQuery({
    queryKey: ['review-queue', courseId],
    queryFn: () => fetchReviewQueue(courseId),
  });
}

function useInvalidateReviewQueue() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['review-queue'] });
}

export function useApproveQuestion() {
  const invalidate = useInvalidateReviewQueue();
  return useMutation({
    mutationFn: async (questionId: string) => {
      const res = await apiFetch(`/api/v1/questions/${questionId}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error(`Failed to approve: ${res.status}`);
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useRejectQuestion() {
  const invalidate = useInvalidateReviewQueue();
  return useMutation({
    mutationFn: async (questionId: string) => {
      const res = await apiFetch(`/api/v1/questions/${questionId}/reject`, { method: 'POST' });
      if (!res.ok) throw new Error(`Failed to reject: ${res.status}`);
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useApproveByConcept() {
  const invalidate = useInvalidateReviewQueue();
  return useMutation({
    mutationFn: async (conceptId: string) => {
      const res = await apiFetch('/api/v1/review-queue/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept_id: conceptId }),
      });
      if (!res.ok) throw new Error(`Failed to bulk approve: ${res.status}`);
      return res.json();
    },
    onSuccess: invalidate,
  });
}
