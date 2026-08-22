import { useEffect } from 'react';
import { playerTimeStore } from './playerTimeStore';

// Subscribes cb to every player-time tick without putting time in React
// state — only components that call this (strip cursor, transcript
// highlight) re-render on tick, and only if their own cb chooses to.
// Fires once immediately with the current time so consumers reflect reality
// before the first tick (e.g. the segment covering t=0 shows active right
// away, not just once playback starts).
export function usePlayerTime(cb: (ms: number) => void): void {
  useEffect(() => {
    cb(playerTimeStore.getState().ms);
    return playerTimeStore.subscribe((state) => cb(state.ms));
  }, [cb]);
}
