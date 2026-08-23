import { Link } from 'react-router-dom';
import { useMarkInvited, useWaitlist } from '../api/waitlist';
import { LogoutButton } from './AppShell';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

// Admin-only (behind RequireAuth in App.tsx) — see db/schema.sql's own
// comment on waitlist_signups: this is where the admin decides who gets a
// real, manually-created login next. "Mark invited" is bookkeeping only —
// it doesn't create an account by itself.
export function WaitlistPage() {
  const { data: items, isPending, isError } = useWaitlist();
  const markInvited = useMarkInvited();

  const pending = (items ?? []).filter((i) => !i.invited);
  const invited = (items ?? []).filter((i) => i.invited);

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-[var(--s-4)] p-[var(--s-5)]">
      <div className="flex items-center justify-between">
        <h1 className="font-[var(--font-display)] text-[var(--step-2)] text-[var(--chalk)]">Waitlist</h1>
        <div className="flex items-center gap-[var(--s-3)]">
          <Link to="/lecture/l01" className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
            Back to course
          </Link>
          <LogoutButton />
        </div>
      </div>

      {isPending && <p className="text-[var(--dust)]">Loading…</p>}
      {isError && <p className="text-[var(--error)]">Couldn't load the waitlist. Try reloading.</p>}
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
                onClick={() => markInvited.mutate(item.id)}
                disabled={markInvited.isPending}
                className="shrink-0 rounded-[var(--radius)] bg-[var(--written)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] font-medium text-[var(--slate)] disabled:opacity-50"
              >
                Mark invited
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
