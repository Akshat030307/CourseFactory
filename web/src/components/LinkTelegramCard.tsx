import { useGenerateLinkCode } from '../api/telegram';

// Shown only for role === 'student' (AppShell.tsx) — the backend endpoint
// itself is role-agnostic (an instructor could generate one on a selected
// student's behalf too), but that's not a workflow this UI needs to expose.
export function LinkTelegramCard() {
  const generate = useGenerateLinkCode();

  if (generate.data) {
    return (
      <span className="text-[var(--step--1)] text-[var(--dust)]">
        Send <code className="text-[var(--written)]">/start {generate.data.code}</code> to the bot within 10
        minutes.
      </span>
    );
  }

  return (
    <button
      onClick={() => generate.mutate()}
      disabled={generate.isPending}
      className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2 disabled:opacity-50"
    >
      {generate.isPending ? 'Generating…' : 'Link Telegram'}
    </button>
  );
}
