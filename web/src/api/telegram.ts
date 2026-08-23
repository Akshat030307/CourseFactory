import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './http';

export interface LinkCode {
  code: string;
  expires_at: string;
}

async function generateLinkCode(): Promise<LinkCode> {
  const res = await apiFetch('/api/v1/telegram/link-code', { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to generate a link code: ${res.status}`);
  return res.json();
}

// gateway/app/routes/telegram.py — a logged-in student generates a
// short-lived code here, then sends `/start <code>` to the Telegram bot to
// link that chat to their account.
export function useGenerateLinkCode() {
  return useMutation({ mutationFn: generateLinkCode });
}
