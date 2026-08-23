import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useJoinWaitlist } from '../api/waitlist';

// Public — no login required, same reasoning as the landing page itself.
// Doesn't create an account: the app is still one manually-issued login
// (Stage 13), not self-service registration. This just captures interest
// so the admin can hand out real credentials by hand — see the waitlist
// admin view (WaitlistPage.tsx) and db/schema.sql's own comment on the
// table this writes to.
export function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const join = useJoinWaitlist();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    join.mutate({ name, email, message: message.trim() || undefined });
  }

  if (join.isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--slate)] p-[var(--s-5)]">
        <div className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-5)] text-center">
          <h1 className="mb-[var(--s-2)] font-[var(--font-display)] text-[var(--step-1)] text-[var(--written)]">
            You're on the list
          </h1>
          <p className="text-[var(--step--1)] text-[var(--dust)]">
            We'll email you a login once a spot opens up.
          </p>
          <Link to="/" className="mt-[var(--s-4)] inline-block text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--slate)] p-[var(--s-5)]">
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-5)]">
        <Link to="/" className="mb-[var(--s-2)] block text-center font-[var(--font-display)] text-[var(--step-1)]">
          Course<span style={{ color: 'var(--written)' }}>Factory</span>
        </Link>
        <p className="mb-[var(--s-4)] text-center text-[var(--step--1)] text-[var(--dust)]">
          Course Factory is invite-only right now. Join the waitlist and we'll send you a login.
        </p>
        <form onSubmit={onSubmit} className="flex flex-col gap-[var(--s-3)]">
          <label className="flex flex-col gap-[var(--s-1)]">
            <span className="text-[var(--step--1)] text-[var(--dust)]">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--chalk)]"
            />
          </label>
          <label className="flex flex-col gap-[var(--s-1)]">
            <span className="text-[var(--step--1)] text-[var(--dust)]">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--chalk)]"
            />
          </label>
          <label className="flex flex-col gap-[var(--s-1)]">
            <span className="text-[var(--step--1)] text-[var(--dust)]">What are you hoping to use it for? (optional)</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--chalk)]"
            />
          </label>
          {join.isError && <p className="text-[var(--error)]">{(join.error as Error).message}</p>}
          <button
            type="submit"
            disabled={join.isPending}
            className="rounded-[var(--radius)] bg-[var(--written)] px-[var(--s-3)] py-[var(--s-2)] font-medium text-[var(--slate)] disabled:opacity-50"
          >
            {join.isPending ? 'Joining…' : 'Join the Waitlist'}
          </button>
        </form>
        <p className="mt-[var(--s-4)] text-center text-[var(--step--1)] text-[var(--dust)]">
          Already have a login? <Link to="/login" className="text-[var(--path)] underline underline-offset-2">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
