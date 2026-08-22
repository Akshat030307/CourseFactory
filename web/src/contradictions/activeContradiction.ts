import { create } from 'zustand';
import type { Contradiction } from '../api/contradictions';

// X1 (Stage 9): selecting a contradiction "splits the stage" — AppShell
// swaps its normal VideoPlayer/BoardStrip/TranscriptLane for SplitView
// while this is set.
interface ActiveContradictionState {
  active: Contradiction | null;
  setActive: (c: Contradiction) => void;
  clear: () => void;
}

export const useActiveContradiction = create<ActiveContradictionState>((set) => ({
  active: null,
  setActive: (c) => set({ active: c }),
  clear: () => set({ active: null }),
}));
