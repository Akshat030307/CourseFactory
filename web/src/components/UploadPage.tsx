import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCourses } from '../api/lectures';
import { useUploadFromYoutube, useUploadLecture } from '../api/upload';
import { LogoutButton } from './AppShell';

const NEW_COURSE = '__new__';

// The real entry point for "an actual person's" own video — not one of the
// four MIT fixtures. Ingestion itself (scripts/ingest.py) already existed;
// this is what was missing: a way to trigger it without a terminal.
//
// Stage 16: a second source (paste a YouTube URL) alongside the original
// file upload — same course/title fields either way, only the video-source
// half of the form and which mutation fires differs.
export function UploadPage() {
  const { data: courses } = useCourses();
  const upload = useUploadLecture();
  const uploadYoutube = useUploadFromYoutube();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'file' | 'youtube'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState<string>(NEW_COURSE);
  const [newCourseTitle, setNewCourseTitle] = useState('');

  const isNewCourse = courseId === NEW_COURSE;
  const hasCourse = isNewCourse ? newCourseTitle.trim().length > 0 : true;
  const hasSource = mode === 'file' ? !!file : youtubeUrl.trim().length > 0;
  const canSubmit = hasSource && title.trim().length > 0 && hasCourse;

  const active = mode === 'file' ? upload : uploadYoutube;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const resolvedCourseId = isNewCourse ? null : courseId;
    const resolvedNewCourseTitle = isNewCourse ? newCourseTitle.trim() : null;
    if (mode === 'file') {
      if (!file) return;
      upload.mutate(
        { file, title: title.trim(), courseId: resolvedCourseId, newCourseTitle: resolvedNewCourseTitle },
        { onSuccess: (data) => navigate(`/lecture/${data.lecture_id}`) },
      );
    } else {
      uploadYoutube.mutate(
        { url: youtubeUrl.trim(), title: title.trim(), courseId: resolvedCourseId, newCourseTitle: resolvedNewCourseTitle },
        { onSuccess: (data) => navigate(`/lecture/${data.lecture_id}`) },
      );
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-[var(--s-4)] p-[var(--s-5)]">
      <div className="flex items-center justify-between">
        <h1 className="font-[var(--font-display)] text-[var(--step-2)] text-[var(--chalk)]">Upload a lecture</h1>
        <div className="flex items-center gap-[var(--s-3)]">
          <Link to="/" className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
            Back to home
          </Link>
          <LogoutButton />
        </div>
      </div>

      <p className="text-[var(--step--1)] text-[var(--dust)]">
        Runs the real pipeline — transcription, board-state extraction, OCR/vision reading, and search
        indexing. Takes a couple of minutes for a short clip; you can watch it happen live in the Trace
        panel once you land on the lecture page.
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-[var(--s-3)]">
        <div className="flex gap-[var(--s-1)]">
          {(['file', 'youtube'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-[var(--radius)] px-[var(--s-3)] py-[var(--s-1)] text-[var(--step--1)] transition-colors ${
                mode === m
                  ? 'bg-[var(--path-dim)] text-[var(--chalk)]'
                  : 'bg-[var(--slate)] text-[var(--dust)] hover:text-[var(--chalk)]'
              }`}
            >
              {m === 'file' ? 'Video file' : 'YouTube URL'}
            </button>
          ))}
        </div>

        {mode === 'file' ? (
          <label className="flex flex-col gap-[var(--s-1)]">
            <span className="text-[var(--step--1)] text-[var(--dust)]">Video file (.mp4 or .webm)</span>
            <input
              type="file"
              accept="video/mp4,video/webm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--chalk)]"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-[var(--s-1)]">
            <span className="text-[var(--step--1)] text-[var(--dust)]">YouTube URL</span>
            <input
              type="url"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--chalk)] placeholder:text-[var(--dust-faint)]"
            />
          </label>
        )}

        <label className="flex flex-col gap-[var(--s-1)]">
          <span className="text-[var(--step--1)] text-[var(--dust)]">Lecture title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Introduction to Eigenvalues"
            className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--chalk)] placeholder:text-[var(--dust-faint)]"
          />
        </label>

        <label className="flex flex-col gap-[var(--s-1)]">
          <span className="text-[var(--step--1)] text-[var(--dust)]">Course</span>
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--chalk)]"
          >
            <option value={NEW_COURSE}>+ New course</option>
            {courses?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>

        {isNewCourse && (
          <label className="flex flex-col gap-[var(--s-1)]">
            <span className="text-[var(--step--1)] text-[var(--dust)]">New course name</span>
            <input
              type="text"
              value={newCourseTitle}
              onChange={(e) => setNewCourseTitle(e.target.value)}
              placeholder="e.g. Intro to Linear Algebra"
              className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--chalk)] placeholder:text-[var(--dust-faint)]"
            />
          </label>
        )}

        {active.isError && (
          <p className="text-[var(--error)]">{(active.error as Error).message}</p>
        )}

        <button
          type="submit"
          disabled={!canSubmit || active.isPending}
          className="self-start rounded-[var(--radius)] bg-[var(--written)] px-[var(--s-4)] py-[var(--s-2)] text-[var(--slate)] font-medium disabled:opacity-50"
        >
          {active.isPending
            ? mode === 'file'
              ? 'Uploading…'
              : 'Starting download…'
            : 'Upload & Start Processing'}
        </button>
      </form>
    </div>
  );
}
