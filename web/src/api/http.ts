// Thin wrapper around fetch(), used everywhere instead of the raw global —
// two things every authenticated call needs that a plain fetch() doesn't
// give you for free:
//   1. `credentials: 'include'` — without this the httpOnly session cookie
//      (gateway/app/routes/auth.py) never gets sent, and every request
//      looks unauthenticated even right after a successful login.
//   2. A session that expired mid-use (cookie past its 7-day max-age)
//      should bounce to /login, not leave the page silently rendering
//      empty states from a stream of 401s.
// Login's own request is exempt from #2 — a wrong password is a 401 too,
// and redirecting away from the login page because of it would be absurd.
// So is the public landing page ("/"): it makes a best-effort, optional
// useLectures() call and falls back gracefully if it 401s (an anonymous
// visitor legitimately can't see real lecture data) — that's an expected
// outcome there, not a dead session, and shouldn't yank a first-time
// visitor into the login page before they've even seen the pitch.
const REDIRECT_EXEMPT_PATHS = ['/login', '/'];

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { ...init, credentials: 'include' });
  if (res.status === 401 && !input.includes('/auth/login') && !REDIRECT_EXEMPT_PATHS.includes(window.location.pathname)) {
    window.location.href = '/login';
  }
  return res;
}
