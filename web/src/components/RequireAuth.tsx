import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from '../api/auth';

// Gates the functional app (course/lecture views, drill, review queue,
// upload) behind login. The landing page and /login itself stay public —
// a marketing page that requires an account to even look at defeats the
// point of having one.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending } = useMe();

  if (isPending) return null;
  if (!data?.authenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
