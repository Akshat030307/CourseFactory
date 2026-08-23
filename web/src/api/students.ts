import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './http';

export interface Student {
  id: string;
  username: string;
  name: string | null;
  has_telegram: boolean;
  created_at: string;
}

async function fetchStudents(): Promise<Student[]> {
  const res = await apiFetch('/api/v1/students');
  if (!res.ok) throw new Error(`Failed to fetch students: ${res.status}`);
  return res.json();
}

// Instructor-only (gateway/app/routes/students.py) — powers AppShell's
// student switcher.
export function useStudents() {
  return useQuery({ queryKey: ['students'], queryFn: fetchStudents });
}
