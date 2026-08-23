import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLogin } from '../api/auth';
import { apiFetch } from '../api/http';
import type { Course } from '../api/lectures';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useLogin();
  const navigate = useNavigate();

  async function onLoginSuccess() {
    // Not useCourses() — this fires the instant login resolves, before any
    // hook value tied to the new session could already be fresh. A plain
    // one-off fetch here, same session cookie apiFetch already attaches.
    let firstCourseId = '18.06';
    try {
      const res = await apiFetch('/api/v1/courses');
      if (res.ok) {
        const courses: Course[] = await res.json();
        firstCourseId = courses[0]?.id ?? firstCourseId;
      }
    } catch {
      // Fall through to the '18.06' fallback — a broken course fetch here
      // shouldn't block landing somewhere reasonable after a real login.
    }
    navigate(`/course/${firstCourseId}`);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    login.mutate({ username, password }, { onSuccess: onLoginSuccess });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--slate)] p-[var(--s-5)]">
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-5)]">
        <Link to="/" className="mb-[var(--s-4)] block text-center font-[var(--font-display)] text-[var(--step-1)]">
          Course<span style={{ color: 'var(--written)' }}>Factory</span>
        </Link>
        <form onSubmit={onSubmit} className="flex flex-col gap-[var(--s-3)]">
          <label className="flex flex-col gap-[var(--s-1)]">
            <span className="text-[var(--step--1)] text-[var(--dust)]">Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--chalk)]"
            />
          </label>
          <label className="flex flex-col gap-[var(--s-1)]">
            <span className="text-[var(--step--1)] text-[var(--dust)]">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--chalk)]"
            />
          </label>
          {login.isError && <p className="text-[var(--error)]">{(login.error as Error).message}</p>}
          <button
            type="submit"
            disabled={login.isPending}
            className="rounded-[var(--radius)] bg-[var(--written)] px-[var(--s-3)] py-[var(--s-2)] font-medium text-[var(--slate)] disabled:opacity-50"
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
