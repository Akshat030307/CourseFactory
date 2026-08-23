import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLectures } from '../api/lectures';
import { type CreatedAccount, useCreateAccount, useWaitlist } from '../api/waitlist';
import { LogoutButton } from './AppShell';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

// Admin-only (behind RequireRole in App.tsx) — see db/schema.sql's own
// comment on waitlist_signups: this is where the admin decides who gets a
// real login next. Stage 15: "Create account" actually generates real
// credentials now (gateway/app/routes/waitlist.py), not just bookkeeping —
// the plaintext password only ever exists in that one response, shown once
// below and never persisted client-side.
export function WaitlistPage() {
  const { data: items, isPending, isError } = useWaitlist();
  const createAccount = useCreateAccount();
  const [justCreated, setJustCreated] = useState<CreatedAccount | null>(null);
  const { data: lectures } = useLectures();
  const firstLecture = lectures?.[0]?.id ?? 'l01';

  const pending = (items ?? []).filter((i) => !i.invited);
  const invited = (items ?? []).filter((i) => i.invited);

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-[var(--s-4)] p-[var(--s-5)]">
      <div className="flex items-center justify-between">
        <h1 className="font-[var(--font-display)] text-[var(--step-2)] text-[var(--chalk)]">Waitlist</h1>
        <div className="flex items-center gap-[var(--s-3)]">
          <Link to={`/lecture/${firstLecture}`} className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
            Back to course
          </Link>
          <LogoutButton />
        </div>
      </div>

      {justCreated && (
        <div className="flex flex-col gap-[var(--s-2)] rounded-[var(--radius)] border border-[var(--written)] bg-[var(--slate-raised)] p-[var(--s-3)]">
          <p className="text-[var(--chalk)]">
            Account created for <strong>{justCreated.name}</strong> — copy these now, they won't be shown again:
          </p>
          <p className="font-mono text-[var(--step--1)] text-[var(--written)]">
            {justCreated.username} / {justCreated.password}
          </p>
          <div className="flex gap-[var(--s-2)]">
            <button
              onClick={() => navigator.clipboard.writeText(`${justCreated.username} / ${justCreated.password}`)}
              className="self-start rounded-[var(--radius)] border border-[var(--slate-line)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--dust)] hover:text-[var(--chalk)]"
            >
              Copy
            </button>
            <button
              onClick={() => setJustCreated(null)}
              className="self-start rounded-[var(--radius)] border border-[var(--slate-line)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--dust)] hover:text-[var(--chalk)]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {isPending && <p className="text-[var(--dust)]">Loading…</p>}
      {isError && <p className="text-[var(--error)]">Couldn't load the waitlist. Try reloading.</p>}
      {createAccount.isError && <p className="text-[var(--error)]">{(createAccount.error as Error).message}</p>}
      {items && items.length === 0 && <p className="text-[var(--dust)]">Nobody's signed up yet.</p>}

      {pending.length > 0 && (
        <section className="flex flex-col gap-[var(--s-2)]">
          <h2 className="text-[var(--step--1)] uppercase tracking-wide text-[var(--dust)]">
            Waiting ({pending.length})
          </h2>
          {pending.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-[var(--s-3)] rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-3)]"
            >
              <div className="flex flex-col gap-[var(--s-1)]">
                <p className="text-[var(--chalk)]">
                  {item.name} · <span className="text-[var(--dust)]">{item.email}</span>
                </p>
                {item.message && <p className="text-[var(--step--1)] text-[var(--dust)] italic">"{item.message}"</p>}
                <p className="ts">{formatDate(item.created_at)}</p>
              </div>
              <button
                onClick={() => createAccount.mutate(item.id, { onSuccess: setJustCreated })}
                disabled={createAccount.isPending}
                className="shrink-0 rounded-[var(--radius)] bg-[var(--written)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] font-medium text-[var(--slate)] disabled:opacity-50"
              >
                Create account
              </button>
            </div>
          ))}
        </section>
      )}

      {invited.length > 0 && (
        <section className="flex flex-col gap-[var(--s-2)]">
          <h2 className="text-[var(--step--1)] uppercase tracking-wide text-[var(--dust)]">
            Invited ({invited.length})
          </h2>
          {invited.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-[var(--s-3)] rounded-[var(--radius)] border border-[var(--slate-line)] p-[var(--s-2)] opacity-60"
            >
              <p className="text-[var(--chalk)]">
                {item.name} · <span className="text-[var(--dust)]">{item.email}</span>
              </p>
              <p className="ts">{formatDate(item.created_at)}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
