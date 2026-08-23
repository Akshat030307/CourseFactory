import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './http';

export interface GraphNode {
  id: string;
  label: string;
  lecture_id: string;
  timestamp_ms: number;
  mastery: number | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'DEPENDS_ON';
}

export interface CourseGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

async function fetchGraph(courseId: string, studentId?: string): Promise<CourseGraph> {
  const qs = studentId ? `?student_id=${encodeURIComponent(studentId)}` : '';
  const res = await apiFetch(`/api/v1/courses/${courseId}/graph${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch graph: ${res.status}`);
  return res.json();
}

// studentId in the query key: the graph's edges/nodes are rebuilt only by
// scripts/build_graph.py (hence staleTime: Infinity), but each node's
// per-student `mastery` overlay changes with who's selected — omitting
// studentId from the key would keep serving a previous student's mastery
// after switching.
//
// courseId is now derived (AppShell's current lecture/course), not a
// hardcoded constant, so it's undefined on first paint until the lectures
// list resolves — `enabled` keeps this from firing a
// `GET /courses/undefined/graph`-shaped request in that window.
export function useGraph(courseId: string | undefined, studentId?: string) {
  return useQuery({
    queryKey: ['graph', courseId ?? null, studentId ?? null],
    queryFn: () => fetchGraph(courseId!, studentId),
    enabled: !!courseId,
    staleTime: Infinity,
  });
}
