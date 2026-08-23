import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './http';

export interface Me {
  authenticated: boolean;
  username: string | null;
}

async function fetchMe(): Promise<Me> {
  // Deliberately plain fetch(), not apiFetch() — this is the one call that
  // must never trigger apiFetch's redirect-on-401 loop, and /auth/me
  // itself never actually returns 401 (it reports {authenticated:false}
  // instead), so the wrapper would be a no-op here anyway.
  const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to check auth: ${res.status}`);
  return res.json();
}

export function useMe() {
  return useQuery({ queryKey: ['auth', 'me'], queryFn: fetchMe, staleTime: 60_000 });
}

interface LoginArgs {
  username: string;
  password: string;
}

async function login(args: LoginArgs): Promise<Me> {
  const res = await apiFetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? body?.title ?? 'Wrong username or password.');
  }
  return res.json();
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (me) => queryClient.setQueryData(['auth', 'me'], me),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'me'], { authenticated: false, username: null });
      window.location.href = '/login';
    },
  });
}
