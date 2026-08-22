import { createStore } from 'zustand/vanilla';

// Video time updates at 60fps and must never live in React state — see
// CLAUDE.md rule 4. This vanilla store's raw `.subscribe()` (not the
// `useStore` React hook) is how usePlayerTime() lets consumers react to
// every tick without forcing the whole tree to re-render.
export const playerTimeStore = createStore<{ ms: number }>(() => ({ ms: 0 }));

export function setPlayerTime(ms: number): void {
  playerTimeStore.setState({ ms });
}

export function getPlayerTime(): number {
  return playerTimeStore.getState().ms;
}
