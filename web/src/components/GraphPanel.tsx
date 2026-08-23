import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useGraph, type GraphEdge, type GraphNode } from '../api/graph';
import { useLectures } from '../api/lectures';
import { navigate } from '../nav/navigate';
import { useEffectiveStudentId } from '../students/useEffectiveStudentId';

// Single demo course fixture — matches SearchPanel's COURSE_ID.
const COURSE_ID = '18.06';

// CLAUDE.md: "200+ force-directed nodes is a slideshow... cap visible at
// ~60." Can't be exercised with real data at fixture scale (13 concepts,
// 4 lectures) — kept as a real slice rather than decoration, same spirit as
// BoardStrip's un-exercised windowing params (B5).
const MAX_VISIBLE_NODES = 60;

type ClusterNode = { kind: 'cluster'; id: string; label: string; lectureId: string; count: number; avgMastery: number | null };
type ConceptNode = { kind: 'concept'; id: string; label: string; lectureId: string; timestampMs: number; mastery: number | null };
type VizNode = ClusterNode | ConceptNode;
type VizLink = { source: string; target: string; to_concept_edges: number };

function clusterId(lectureId: string): string {
  return `lecture:${lectureId}`;
}

// P1: tint by mastery.score instead of a flat color — the collapsed cluster
// view (the default) is the one place a student/instructor sees the whole
// course at once, so it's the one place a mastery dashboard actually pays
// off. null (never attempted) stays a neutral fallback color rather than
// getting pulled toward "struggling" — no data isn't the same claim as low
// mastery. Threshold-free gradient (not a hard cutoff) since R1's own
// MASTERY_THRESHOLD=0.6 already exists server-side for eligibility — this
// is a continuous readout, not a second copy of that decision.
const MASTERY_LOW = [0xc9, 0x70, 0x64]; // --error
const MASTERY_HIGH = [0x7f, 0xa8, 0x6f]; // --ok

function masteryColor(mastery: number | null, fallback: string): string {
  if (mastery === null) return fallback;
  const t = Math.max(0, Math.min(1, mastery));
  const rgb = MASTERY_LOW.map((c, i) => Math.round(c + (MASTERY_HIGH[i] - c) * t));
  return `rgb(${rgb.join(',')})`;
}

export function GraphPanel() {
  const studentId = useEffectiveStudentId();
  const { data: graph, isPending, isError } = useGraph(COURSE_ID, studentId);
  const { data: lectures } = useLectures(studentId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 360 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSize({ width, height: Math.max(height, 280) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const lectureTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lectures ?? []) map.set(l.id, l.title);
    return map;
  }, [lectures]);

  const { nodes, links, truncated } = useMemo(
    () => buildViz(graph?.nodes ?? [], graph?.edges ?? [], expanded, lectureTitle),
    [graph, expanded, lectureTitle],
  );

  function onNodeClick(node: VizNode) {
    if (node.kind === 'cluster') {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.has(node.lectureId) ? next.delete(node.lectureId) : next.add(node.lectureId);
        return next;
      });
    } else {
      // navigate() (R2, Stage 7) handles both cases: same-lecture seeks
      // immediately, cross-lecture pushes the nav stack and routes there.
      navigate(node.lectureId, node.timestampMs);
    }
  }

  if (isPending) return <p className="text-[var(--dust)]">Loading graph…</p>;
  if (isError) return <p className="text-[var(--error)]">Couldn't load the concept graph. Check the gateway is running, then reload.</p>;
  if (nodes.length === 0) return <p className="text-[var(--dust)]">No concepts extracted yet — run scripts/build_graph.py.</p>;

  return (
    <div className="flex flex-col gap-[var(--s-2)]">
      <p className="text-[var(--step--1)] text-[var(--dust)]">
        {expanded.size === 0 ? 'Click a lecture to expand its concepts.' : `${expanded.size} lecture${expanded.size === 1 ? '' : 's'} expanded.`}
        {truncated && ` Showing first ${MAX_VISIBLE_NODES} nodes.`}
      </p>
      <p className="text-[var(--step--1)] text-[var(--dust)]">
        Node color: <span style={{ color: masteryColor(0, '#9C9280') }}>struggling</span> →{' '}
        <span style={{ color: masteryColor(1, '#9C9280') }}>mastered</span>, gray = not yet attempted.
      </p>
      <div ref={containerRef} className="min-h-[280px] flex-1 overflow-hidden rounded-[var(--radius)] border border-[var(--slate-line)]">
        <ForceGraph2D
          width={size.width}
          height={size.height}
          graphData={{ nodes, links }}
          nodeId="id"
          nodeLabel={(n) => (n as VizNode).label}
          nodeVal={(n) => ((n as VizNode).kind === 'cluster' ? 6 + (n as ClusterNode).count : 4)}
          nodeColor={(n) => {
            const node = n as VizNode;
            return node.kind === 'cluster'
              ? masteryColor(node.avgMastery, '#9C9280')
              : masteryColor(node.mastery, '#9C9280');
          }}
          linkColor={() => 'rgba(224, 184, 76, 0.45)'}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          backgroundColor="#0D0D0D"
          onNodeClick={(n) => onNodeClick(n as VizNode)}
        />
      </div>
    </div>
  );
}

function buildViz(
  allNodes: GraphNode[],
  allEdges: GraphEdge[],
  expanded: Set<string>,
  lectureTitle: Map<string, string>,
): { nodes: VizNode[]; links: VizLink[]; truncated: boolean } {
  const nodesByLecture = new Map<string, GraphNode[]>();
  for (const n of allNodes) {
    const list = nodesByLecture.get(n.lecture_id) ?? [];
    list.push(n);
    nodesByLecture.set(n.lecture_id, list);
  }

  // Every concept resolves to whichever id is currently on screen: its own
  // id if its lecture is expanded, otherwise its lecture's cluster id.
  const visibleIdFor = new Map<string, string>();
  const nodes: VizNode[] = [];
  for (const [lectureId, concepts] of nodesByLecture) {
    if (expanded.has(lectureId)) {
      for (const c of concepts) {
        visibleIdFor.set(c.id, c.id);
        nodes.push({ kind: 'concept', id: c.id, label: c.label, lectureId, timestampMs: c.timestamp_ms, mastery: c.mastery });
      }
    } else {
      const cid = clusterId(lectureId);
      for (const c of concepts) visibleIdFor.set(c.id, cid);
      const known = concepts.filter((c) => c.mastery !== null);
      const avgMastery = known.length > 0 ? known.reduce((sum, c) => sum + c.mastery!, 0) / known.length : null;
      nodes.push({ kind: 'cluster', id: cid, label: lectureTitle.get(lectureId) ?? lectureId, lectureId, count: concepts.length, avgMastery });
    }
  }

  const truncated = nodes.length > MAX_VISIBLE_NODES;
  const visibleNodes = truncated ? nodes.slice(0, MAX_VISIBLE_NODES) : nodes;
  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

  const linkCounts = new Map<string, number>();
  for (const e of allEdges) {
    const from = visibleIdFor.get(e.from);
    const to = visibleIdFor.get(e.to);
    if (!from || !to || from === to) continue;
    if (!visibleNodeIds.has(from) || !visibleNodeIds.has(to)) continue;
    const key = `${from}->${to}`;
    linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
  }
  const links: VizLink[] = [...linkCounts.keys()].map((key) => {
    const [source, target] = key.split('->');
    return { source, target, to_concept_edges: linkCounts.get(key)! };
  });

  return { nodes: visibleNodes, links, truncated };
}
