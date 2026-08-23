import { create } from 'zustand';

// Which student the INSTRUCTOR is currently viewing — meaningless for a
// student session (they only ever see their own data, see
// useEffectiveStudentId). Not persisted to localStorage, matching
// navStack.ts/activeContradiction.ts's own plain create() with no
// persistence.
interface SelectedStudentState {
  studentId: string | null;
  setStudentId: (id: string | null) => void;
}

export const useSelectedStudent = create<SelectedStudentState>((set) => ({
  studentId: null,
  setStudentId: (id) => set({ studentId: id }),
}));
