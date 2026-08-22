import { useEffect, useState } from 'react';

export interface TraceLine {
  seq: number;
  stage: string | null;
  pct: number | null;
  message: string | null;
}

interface JobTraceState {
  lines: TraceLine[];
  costCents: number;
  status: 'idle' | 'connecting' | 'live' | 'done' | 'failed';
  error: string | null;
}

// X5: node.*/cost.update stand-ins, streamed over the existing /ws job
// channel (gateway/app/ws.py) — no RocketRide DAP client, since no stage
// of this build ever routes through a RocketRide pipeline to trace.
export function useJobTrace(jobId: string | null): JobTraceState {
  const [state, setState] = useState<JobTraceState>({ lines: [], costCents: 0, status: 'idle', error: null });

  useEffect(() => {
    if (!jobId) {
      setState({ lines: [], costCents: 0, status: 'idle', error: null });
      return;
    }
    setState({ lines: [], costCents: 0, status: 'connecting', error: null });

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', job_id: jobId }));
      setState((s) => ({ ...s, status: 'live' }));
    };

    ws.onmessage = (event) => {
      const frame = JSON.parse(event.data);
      if (frame.job_id !== jobId) return;
      if (frame.type === 'job.progress') {
        setState((s) => ({
          ...s,
          lines: [...s.lines, { seq: frame.seq, stage: frame.payload.stage, pct: frame.payload.pct, message: frame.payload.message }],
        }));
      } else if (frame.type === 'cost.update') {
        setState((s) => ({ ...s, costCents: frame.payload.cents }));
      } else if (frame.type === 'job.complete') {
        setState((s) => ({ ...s, status: 'done' }));
      } else if (frame.type === 'job.failed') {
        setState((s) => ({ ...s, status: 'failed', error: frame.payload.error }));
      }
    };

    ws.onerror = () => setState((s) => ({ ...s, status: 'failed', error: 'WebSocket error' }));

    return () => ws.close();
  }, [jobId]);

  return state;
}
