import { useQuery } from '@tanstack/react-query';

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

async function fetchGraph(courseId: string): Promise<CourseGraph> {
  const res = await fetch(`/api/v1/courses/${courseId}/graph`);
  if (!res.ok) throw new Error(`Failed to fetch graph: ${res.status}`);
  return res.json();
}

export function useGraph(courseId: string) {
  return useQuery({
    queryKey: ['graph', courseId],
    queryFn: () => fetchGraph(courseId),
    staleTime: Infinity, // rebuilt only by re-running scripts/build_graph.py
  });
}
