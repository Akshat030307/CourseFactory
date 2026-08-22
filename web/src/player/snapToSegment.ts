const PREROLL_MS = 1500;

export interface SegmentBounds {
  start_ms: number;
  end_ms: number;
}

// Raw-millisecond seeks land mid-word — see CLAUDE.md rule 5. Snap backward
// to the start of whichever segment `ms` falls in (or the last one at/before
// it, if segments have gaps), then back off by 1500ms of pre-roll.
// Assumes `segments` is sorted ascending by start_ms.
export function snapToSegment(ms: number, segments: SegmentBounds[]): number {
  let base = 0;
  for (const seg of segments) {
    if (seg.start_ms > ms) break;
    base = seg.start_ms;
  }
  return Math.max(0, base - PREROLL_MS);
}
