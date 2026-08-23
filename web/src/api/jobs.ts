import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './http';

export interface LatestJob {
  id: string;
  lecture_id: string | null;
  status: string;
  error: string | null;
}

async function fetchLatestJob(): Promise<LatestJob | null> {
  const res = await apiFetch('/api/v1/jobs/latest');
  if (!res.ok) throw new Error(`Failed to fetch latest job: ${res.status}`);
  return res.json();
}

export function useLatestJob() {
  return useQuery({
    queryKey: ['jobs', 'latest'],
    queryFn: fetchLatestJob,
    // X5: the trace panel discovers what's running rather than being told —
    // ingestion is CLI-triggered, so short polling is how the panel notices
    // a new job started at all.
    refetchInterval: 3000,
  });
}
