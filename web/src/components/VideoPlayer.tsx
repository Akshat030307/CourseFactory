import { useEffect, useRef } from 'react';
import { registerPlayer, setPlaying } from '../player/playerControls';
import { setPlayerTime } from '../player/playerTimeStore';

interface VideoPlayerProps {
  lectureId: string;
  // Set from the `?t=` query param (see nav/navigate.ts) when a
  // cross-lecture navigate() lands here — applied once on mount, before
  // this component has a chance to register with playerControls the normal
  // way (which only handles already-mounted, same-lecture seeks).
  initialSeekMs?: number;
}

export function VideoPlayer({ lectureId, initialSeekMs }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const seek = (ms: number) => {
      video.currentTime = ms / 1000;
    };
    if (initialSeekMs !== undefined) seek(initialSeekMs);
    const unregister = registerPlayer(lectureId, seek);

    const onTimeUpdate = () => setPlayerTime(video.currentTime * 1000);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    return () => {
      unregister();
      setPlaying(false);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [lectureId]);

  return (
    <video
      ref={videoRef}
      key={lectureId}
      src={`/lectures/${lectureId}.mp4`}
      controls
      // No height cap here meant the browser sized the video by intrinsic
      // aspect ratio at full width — 966px tall on real footage, taller than
      // the whole Stage column. That squeezed BoardStrip/TranscriptLane's
      // flex-1 space to 0px: their content was rendering, just inside a
      // zero-height box, so nothing appeared no matter how far you scrolled.
      className="max-h-[45vh] w-full rounded-[var(--radius-lg)] bg-black"
    />
  );
}
