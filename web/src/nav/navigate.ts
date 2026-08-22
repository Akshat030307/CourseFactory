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

// P2: deep links. `lane` matches the vocabulary scripts/mcp_server.py's own
// deep_link() already emits (a search result's `source`: 'transcript' |
// 'board', or 'both' when not lane-specific) — this is the consumer side of
// a contract D1 already produces, not a new one. Only 'board' currently
// changes what the landing page shows (BoardStrip restores the highlight a
// live written-lane search would have set); 'transcript' is accepted for
// URL-shape consistency but needs no restoration since TranscriptLane's
// active-segment highlight is already time-based, not search-based.
type Lane = 'transcript' | 'board' | 'both';

// Same-lecture: seeks immediately, no route change, nothing pushed (not a
// lecture change — rule 6 only applies when lectureId actually changes).
// Cross-lecture: pushes {currentLectureId, current player ms} so
// returnToOrigin() can get back, then navigates to
// `/lecture/{target}?t={ms}` — VideoPlayer reads `?t=` on mount and seeks
// once the new player's registered (see AppShell/VideoPlayer).
export function navigate(targetLectureId: string, targetMs: number, lane?: Lane): void {
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
  const laneParam = lane ? `&lane=${lane}` : '';
  routerNavigate(`/lecture/${targetLectureId}?t=${targetMs}${laneParam}`);
}

export function returnToOrigin(): void {
  const entry = useNavStack.getState().pop();
  if (!entry || !routerNavigate) return;
  routerNavigate(`/lecture/${entry.lectureId}?t=${entry.ms}`);
}
