import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './http';

export interface WaitlistItem {
  id: number;
  name: string;
  email: string;
  message: string | null;
  invited: boolean;
  created_at: string;
}

interface JoinArgs {
  name: string;
  email: string;
  message?: string;
}

async function joinWaitlist(args: JoinArgs): Promise<{ ok: boolean }> {
  const res = await apiFetch('/api/v1/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? 'Something went wrong — try again.');
  }
  return res.json();
}

export function useJoinWaitlist() {
  return useMutation({ mutationFn: joinWaitlist });
}

async function fetchWaitlist(): Promise<WaitlistItem[]> {
  const res = await apiFetch('/api/v1/waitlist');
  if (!res.ok) throw new Error(`Failed to fetch waitlist: ${res.status}`);
  return res.json();
}

export function useWaitlist() {
  return useQuery({ queryKey: ['waitlist'], queryFn: fetchWaitlist });
}

export function useMarkInvited() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/v1/waitlist/${id}/invite`, { method: 'POST' });
      if (!res.ok) throw new Error(`Failed to mark invited: ${res.status}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waitlist'] }),
  });
}
