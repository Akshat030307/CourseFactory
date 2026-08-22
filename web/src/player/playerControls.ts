// Imperative control surface for the single active VideoPlayer instance.
// TranscriptLane (and later BoardStrip, RemediationCard) call seekTo()
// directly rather than threading player state through props.
interface PlayerControls {
  lectureId: string | null;
  seek: ((ms: number) => void) | null;
  playing: boolean;
}

const controls: PlayerControls = { lectureId: null, seek: null, playing: false };

export function registerPlayer(lectureId: string, seek: (ms: number) => void): () => void {
  controls.lectureId = lectureId;
  controls.seek = seek;
  return () => {
    if (controls.lectureId === lectureId) {
      controls.lectureId = null;
      controls.seek = null;
    }
  };
}

// Lets time-driven UI (BoardStrip's active-frame tracking) tell the
// difference between "the playhead is actually advancing" and "a tick fired
// because a seek just landed." See BoardStrip's stepTo for why that matters.
export function setPlaying(playing: boolean): void {
  controls.playing = playing;
}

export function isPlaying(): boolean {
  return controls.playing;
}

// Same-lecture seeks apply immediately. Cross-lecture seeks (remediation,
// Stage 7) need a route change first — not wired yet; see R2's nav stack.
export function seekTo(lectureId: string, ms: number): void {
  if (controls.lectureId !== lectureId || !controls.seek) {
    console.warn(`seekTo: no active player for lecture ${lectureId} (cross-lecture nav lands in R2)`);
    return;
  }
  controls.seek(ms);
}
