import { create } from 'zustand';

// Board-lane search hits render in BoardStrip, not as a duplicate text list
// (see S3 / docs/TASKS.md) — SearchPanel writes matched frame ids here,
// BoardStrip reads them to highlight the corresponding thumbnails. Ordinary
// Zustand hook (not the vanilla-store pattern in playerTimeStore) since this
// updates on search, not 60fps.
interface SearchHighlightState {
  frameIds: Set<string>;
  setHighlights: (ids: string[]) => void;
  clear: () => void;
}

export const useSearchHighlights = create<SearchHighlightState>((set) => ({
  frameIds: new Set(),
  setHighlights: (ids) => set({ frameIds: new Set(ids) }),
  clear: () => set({ frameIds: new Set() }),
}));
