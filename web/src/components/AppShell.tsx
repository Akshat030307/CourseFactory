import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BoardStrip } from './BoardStrip';
import { ContradictionsPanel } from './ContradictionsPanel';
import { GraphPanel } from './GraphPanel';
import { LinkTelegramCard } from './LinkTelegramCard';
import { QuizPanel } from './QuizPanel';
import { ReturnPill } from './ReturnPill';
import { SearchPanel } from './SearchPanel';
import { SplitView } from './SplitView';
import { TracePanel } from './TracePanel';
import { TranscriptLane } from './TranscriptLane';
import { VideoPlayer } from './VideoPlayer';
import { useLogout, useMe } from '../api/auth';
import { useLectures } from '../api/lectures';
import { useStudents } from '../api/students';
import { useActiveContradiction } from '../contradictions/activeContradiction';
import { useNavStack } from '../nav/navStack';
import { registerRouterContext, returnToOrigin } from '../nav/navigate';
import { useSelectedStudent } from '../students/selectedStudent';

interface AppShellProps {
  view: 'course' | 'lecture';
}

// Three-column layout: CourseRail | Stage | Inspector.
// CourseRail is still an empty shell — populated in Stage 1 (upload).
// Stage itself is fully wired for the lecture view: VideoPlayer, BoardStrip,
// TranscriptLane (I4 + B5). Inspector now has SearchPanel (S3); GraphPanel/
// QuizPanel/ReviewQueue/TracePanel land in Stage 5/6/9.
export function AppShell({ view }: AppShellProps) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const routerNavigate = useNavigate();
  const activeContradiction = useActiveContradiction((s) => s.active);
  const { data: me } = useMe();
  const { data: lectures } = useLectures();
  const currentLecture = lectures?.find((l) => l.id === id);
  const [courseCollapsed, setCourseCollapsed] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);

  // A quiz modal left open across a lecture change would show a stale
  // question (or, worse, momentarily the wrong lecture's) — close it
  // whenever the route's lectureId changes, same reasoning as VideoPlayer's
  // and QuizPanel's own key={lectureId} remounts elsewhere in this file.
  useEffect(() => {
    setQuizOpen(false);
  }, [id]);

  // nav/navigate.ts is called from plain modules (SearchPanel, GraphPanel,
  // QuizPanel) that don't have router context of their own — this is where
  // that context actually comes from, re-registered every render so it
  // never goes stale after a route change.
  useEffect(() => {
    registerRouterContext((path) => routerNavigate(path), id ?? null);
    return () => registerRouterContext(null, null);
  }, [routerNavigate, id]);

  // P3: Esc backs out of whatever's currently "on top" — the quiz modal
  // first (it's a true overlay, above everything else), then a
  // contradiction split view (replaces the whole Stage column), then a
  // cross-lecture remediation jump (rule 6's nav stack) — never more than
  // one at once, since navStack.push only happens on an actual lecture
  // change and a split view doesn't touch it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (quizOpen) {
        setQuizOpen(false);
        return;
      }
      if (useActiveContradiction.getState().active) {
        useActiveContradiction.getState().clear();
        return;
      }
      if (useNavStack.getState().stack.length > 0) returnToOrigin();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [quizOpen]);

  const tParam = searchParams.get('t');
  const initialSeekMs = tParam !== null ? Number(tParam) : undefined;

  return (
    <div className="flex min-h-screen flex-col md:grid md:h-screen md:grid-cols-[300px_1fr_320px] md:grid-rows-[56px_1fr] md:overflow-hidden">
      <ReturnPill />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-[var(--s-3)] gap-y-[var(--s-1)] border-b border-[var(--slate-line)] px-[var(--s-4)] py-[var(--s-2)] md:col-span-3 md:py-0">
        <Link to="/" className="font-[var(--font-display)] text-[var(--step-1)]">
          Course Factory
        </Link>
        <div className="flex flex-wrap items-center gap-[var(--s-3)]">
          {me?.role === 'instructor' && <StudentSwitcher />}
          <Link to="/drill" className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
            Due reviews
          </Link>
          {me?.role === 'instructor' && (
            <>
              <Link to="/upload" className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
                Upload a lecture
              </Link>
              <Link to="/review" className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
                Instructor queue
              </Link>
              <Link to="/waitlist" className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
                Waitlist
              </Link>
            </>
          )}
          {me?.role === 'student' && <LinkTelegramCard />}
          <LogoutButton />
        </div>
      </header>

      <Column
        title="Course"
        className="order-3 border-t border-[var(--slate-line)] md:order-none md:border-t-0 md:border-r"
        headerAction={
          <button
            onClick={() => setCourseCollapsed((c) => !c)}
            className="text-[var(--step--1)] text-[var(--path)] hover:text-[var(--chalk)]"
          >
            {courseCollapsed ? 'Show' : 'Hide'}
          </button>
        }
      >
        {!courseCollapsed && <CourseRail activeLectureId={view === 'lecture' ? id : undefined} />}
        {/* Quiz lives next to course navigation, not buried at the bottom
            of a long read-only Inspector column — but as a launcher button
            rather than an always-open panel, so it doesn't compete for
            space with the course rail above it. */}
        {view === 'lecture' && id && (
          <div className="mt-[var(--s-5)]">
            <button
              onClick={() => setQuizOpen(true)}
              className="w-full rounded-[var(--radius)] bg-[var(--written)] px-[var(--s-3)] py-[var(--s-2)] text-[var(--step-0)] font-medium text-[var(--slate)] hover:opacity-90"
            >
              Take Quiz
            </button>
          </div>
        )}
      </Column>

      <Column title="Stage" className="order-1 md:order-none">
        {activeContradiction ? (
          <SplitView contradiction={activeContradiction} />
        ) : view === 'lecture' && id && currentLecture ? (
          <div className="flex h-full flex-col gap-[var(--s-4)]">
            <VideoPlayer lectureId={id} videoUrl={currentLecture.video_url} initialSeekMs={initialSeekMs} />
            <BoardStrip lectureId={id} />
            {/* max-h-[60vh] below md: on mobile the Stage column has no
                bounded ancestor height (the whole page scrolls instead of
                three nested scrollboxes — see the Column comment below), so
                flex-1 alone can't cap this — a real 150+-segment transcript
                rendered unbounded there, making the page 7000px+ tall.
                md:max-h-none restores the desktop behavior, where flex-1
                already correctly fills the bounded column. */}
            <div className="min-h-0 max-h-[60vh] flex-1 overflow-y-auto md:max-h-none">
              <TranscriptLane lectureId={id} />
            </div>
          </div>
        ) : view === 'lecture' && id && lectures ? (
          <p className="text-[var(--error)]">
            Lecture "{id}" not found. <Link to="/upload" className="underline underline-offset-2">Upload it</Link>?
          </p>
        ) : (
          <p className="text-[var(--dust)]">Select a lecture from the course rail to begin.</p>
        )}
      </Column>

      <Column title="Inspector" className="order-2 border-t border-[var(--slate-line)] md:order-none md:border-t-0 md:border-l">
        <SearchPanel />
        <div className="mt-[var(--s-5)] flex flex-col gap-[var(--s-2)]">
          <h3 className="text-[var(--step--1)] uppercase tracking-wide text-[var(--dust)]">Concept graph</h3>
          <GraphPanel />
        </div>
        <div className="mt-[var(--s-5)] flex flex-col gap-[var(--s-2)]">
          <h3 className="text-[var(--step--1)] uppercase tracking-wide text-[var(--dust)]">Contradictions</h3>
          <ContradictionsPanel />
        </div>
        <div className="mt-[var(--s-5)] flex flex-col gap-[var(--s-2)]">
          <h3 className="text-[var(--step--1)] uppercase tracking-wide text-[var(--dust)]">Trace</h3>
          <TracePanel />
        </div>
      </Column>

      {quizOpen && view === 'lecture' && id && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-[var(--s-4)]"
          onClick={() => setQuizOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-4)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-[var(--s-3)] flex items-center justify-between">
              <h3 className="text-[var(--step-1)] text-[var(--chalk)]">Quiz</h3>
              <button
                onClick={() => setQuizOpen(false)}
                className="text-[var(--step-1)] text-[var(--dust)] hover:text-[var(--chalk)]"
              >
                ✕
              </button>
            </div>
            {/* key={id}: forces a fresh mount on lecture change so stale
                index/selected/result state (e.g. a remediation card from
                the previous lecture's wrong answer) can't linger — same
                class of bug VideoPlayer's own key={lectureId} avoids,
                found by actually watching a real cross-lecture navigate()
                land instead of assuming the prop change was enough. */}
            <QuizPanel key={id} lectureId={id} />
          </div>
        </div>
      )}
    </div>
  );
}

// Exported so the standalone pages (DrillPage, ReviewQueuePage, UploadPage)
// can reuse the same control in their own headers rather than each
// reimplementing the logout call.
export function LogoutButton() {
  const logout = useLogout();
  return (
    <button
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      className="text-[var(--step--1)] text-[var(--dust)] hover:text-[var(--chalk)] disabled:opacity-50"
    >
      Log out
    </button>
  );
}

// Instructor-only (rendered conditionally above) — picks whose
// mastery/lecture/graph data the rest of the app shows. A plain native
// <select>, not a custom dropdown component: this codebase deliberately
// has no component library beyond Tailwind, and a native select is the
// simplest thing that actually works here.
function StudentSwitcher() {
  const { data: students } = useStudents();
  const studentId = useSelectedStudent((s) => s.studentId);
  const setStudentId = useSelectedStudent((s) => s.setStudentId);

  if (!students || students.length === 0) return null;

  return (
    <select
      value={studentId ?? ''}
      onChange={(e) => setStudentId(e.target.value || null)}
      className="rounded-[var(--radius)] border border-[var(--slate-line)] bg-[var(--slate)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--chalk)]"
    >
      <option value="">Demo student</option>
      {students.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name ?? s.username}
        </option>
      ))}
    </select>
  );
}

function Column({
  title,
  className = '',
  headerAction,
  children,
}: {
  title: string;
  className?: string;
  headerAction?: ReactNode;
  children?: ReactNode;
}) {
  // Independent per-column scrolling only makes sense once the 3-column
  // desktop grid gives each column a bounded height (md:h-screen on the
  // shell). Below that, the shell is a plain flex-col and the whole page
  // scrolls — three nested scrollboxes stacked on a phone is its own kind
  // of broken (P4).
  return (
    <section className={`bg-[var(--slate-raised)] p-[var(--s-4)] md:h-full md:overflow-y-auto ${className}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-[var(--step--1)] uppercase tracking-wide text-[var(--dust)]">{title}</h2>
        {headerAction}
      </div>
      {children}
    </section>
  );
}

// P5: the Stage column's empty state used to point at "the course rail" —
// which, until now, was a stub comment rendering nothing. Pointing a
// student at a control that doesn't exist is worse than no message at all.
// Minimal real content, not the full Stage 1 rail spec (mastery dots,
// upload) — just enough for "select a lecture" to actually be true.
function CourseRail({ activeLectureId }: { activeLectureId?: string }) {
  const { data: lectures, isPending, isError } = useLectures();

  if (isPending) return <p className="text-[var(--dust)]">Loading lectures…</p>;
  if (isError) return <p className="text-[var(--error)]">Couldn't load lectures. Try reloading.</p>;
  if (!lectures?.length) return <p className="text-[var(--dust)]">No lectures ingested yet — run scripts/ingest.py.</p>;

  return (
    <ul className="mt-[var(--s-2)] flex flex-col gap-[var(--s-1)]">
      {lectures
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((l) => (
          <li key={l.id}>
            <Link
              to={`/lecture/${l.id}`}
              className={`block rounded-[var(--radius)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] ${
                l.id === activeLectureId
                  ? 'bg-[var(--path-dim)] text-[var(--chalk)]'
                  : 'text-[var(--dust)] hover:bg-[var(--slate-line)] hover:text-[var(--chalk)]'
              }`}
            >
              {l.title}
            </Link>
          </li>
        ))}
    </ul>
  );
}
