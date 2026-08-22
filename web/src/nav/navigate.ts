// Imperative navigation, callable from outside React (mirrors
// player/playerControls.ts's registerPlayer/seekTo pattern) — AppShell
// registers react-router's navigate function and the current lectureId
// once per render; SearchPanel/GraphPanel/QuizPanel call navigate() the
// same way they'd have called seekTo(), without needing router context
// themselves.
import { getPlayerTime } from '../player/playerTimeStore';
import { seekTo } from '../player/playerControls';
import { useNavStack } from './navStack';

type RouterNavigate = (path: string) => void;

let routerNavigate: RouterNavigate | null = null;
let currentLectureId: string | null = null;

export function registerRouterContext(fn: RouterNavigate | null, lectureId: string | null): void {
  routerNavigate = fn;
  currentLectureId = lectureId;
}

// Same-lecture: seeks immediately, no route change, nothing pushed (not a
// lecture change — rule 6 only applies when lectureId actually changes).
// Cross-lecture: pushes {currentLectureId, current player ms} so
// returnToOrigin() can get back, then navigates to
// `/lecture/{target}?t={ms}` — VideoPlayer reads `?t=` on mount and seeks
// once the new player's registered (see AppShell/VideoPlayer).
export function navigate(targetLectureId: string, targetMs: number): void {
  if (targetLectureId === currentLectureId) {
    seekTo(targetLectureId, targetMs);
    return;
  }
  if (!routerNavigate) {
    console.warn('navigate: router context not registered yet');
    return;
  }
  if (currentLectureId) {
    useNavStack.getState().push({ lectureId: currentLectureId, ms: getPlayerTime() });
  }
  routerNavigate(`/lecture/${targetLectureId}?t=${targetMs}`);
}

export function returnToOrigin(): void {
  const entry = useNavStack.getState().pop();
  if (!entry || !routerNavigate) return;
  routerNavigate(`/lecture/${entry.lectureId}?t=${entry.ms}`);
}
