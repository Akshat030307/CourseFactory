import { create } from 'zustand';

// CLAUDE.md rule 6: every navigate() that changes lectureId pushes here.
// returnToOrigin() (navigate.ts) pops it. Without this, a student dropped
// into another lecture by remediation has no way back and the flow dies.
export interface NavEntry {
  lectureId: string;
  ms: number;
}

interface NavStackState {
  stack: NavEntry[];
  push: (entry: NavEntry) => void;
  pop: () => NavEntry | undefined;
}

export const useNavStack = create<NavStackState>((set, get) => ({
  stack: [],
  push: (entry) => set((s) => ({ stack: [...s.stack, entry] })),
  pop: () => {
    const { stack } = get();
    if (stack.length === 0) return undefined;
    const top = stack[stack.length - 1];
    set({ stack: stack.slice(0, -1) });
    return top;
  },
}));
