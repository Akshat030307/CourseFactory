import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BoardStrip } from './BoardStrip';
import { ContradictionsPanel } from './ContradictionsPanel';
import { GraphPanel } from './GraphPanel';
import { QuizPanel } from './QuizPanel';
import { ReturnPill } from './ReturnPill';
import { SearchPanel } from './SearchPanel';
import { SplitView } from './SplitView';
import { TracePanel } from './TracePanel';
import { TranscriptLane } from './TranscriptLane';
import { VideoPlayer } from './VideoPlayer';
import { useLectures } from '../api/lectures';
import { useActiveContradiction } from '../contradictions/activeContradiction';
import { useNavStack } from '../nav/navStack';
import { registerRouterContext, returnToOrigin } from '../nav/navigate';

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

  // nav/navigate.ts is called from plain modules (SearchPanel, GraphPanel,
  // QuizPanel) that don't have router context of their own — this is where
  // that context actually comes from, re-registered every render so it
  // never goes stale after a route change.
  useEffect(() => {
    registerRouterContext((path) => routerNavigate(path), id ?? null);
    return () => registerRouterContext(null, null);
  }, [routerNavigate, id]);

  // P3: Esc backs out of whatever's currently "on top" — a contradiction
  // split view first (it's a modal-ish overlay replacing the whole Stage
  // column), then a cross-lecture remediation jump (rule 6's nav stack) —
  // never both at once, since navStack.push only happens on an actual
  // lecture change and a split view doesn't touch it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (useActiveContradiction.getState().active) {
        useActiveContradiction.getState().clear();
        return;
      }
      if (useNavStack.getState().stack.length > 0) returnToOrigin();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const tParam = searchParams.get('t');
  const initialSeekMs = tParam !== null ? Number(tParam) : undefined;

  return (
    <div className="flex min-h-screen flex-col md:grid md:h-screen md:grid-cols-[240px_1fr_360px] md:grid-rows-[56px_1fr] md:overflow-hidden">
      <ReturnPill />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-[var(--s-3)] gap-y-[var(--s-1)] border-b border-[var(--slate-line)] px-[var(--s-4)] py-[var(--s-2)] md:col-span-3 md:py-0">
        <span className="font-[var(--font-display)] text-[var(--step-1)]">Course Factory</span>
        <div className="flex gap-[var(--s-3)]">
          <Link to="/drill" className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
            Due reviews
          </Link>
          <Link to="/review" className="text-[var(--step--1)] text-[var(--path)] underline underline-offset-2">
            Instructor queue
          </Link>
        </div>
      </header>

      <Column title="Course" className="order-3 border-t border-[var(--slate-line)] md:order-none md:border-t-0 md:border-r">
        <CourseRail activeLectureId={view === 'lecture' ? id : undefined} />
      </Column>

      <Column title="Stage" className="order-1 md:order-none">
        {activeContradiction ? (
          <SplitView contradiction={activeContradiction} />
        ) : view === 'lecture' && id ? (
          <div className="flex h-full flex-col gap-[var(--s-4)]">
            <VideoPlayer lectureId={id} initialSeekMs={initialSeekMs} />
            <BoardStrip lectureId={id} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <TranscriptLane lectureId={id} />
            </div>
          </div>
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
        {view === 'lecture' && id && (
          <div className="mt-[var(--s-5)] flex flex-col gap-[var(--s-2)]">
            <h3 className="text-[var(--step--1)] uppercase tracking-wide text-[var(--dust)]">Quiz</h3>
            {/* key={id}: forces a fresh mount on lecture change so stale
                index/selected/result state (e.g. a remediation card from
                the previous lecture's wrong answer) can't linger — same
                class of bug VideoPlayer's own key={lectureId} avoids,
                found by actually watching a real cross-lecture navigate()
                land instead of assuming the prop change was enough. */}
            <QuizPanel key={id} lectureId={id} />
          </div>
        )}
        <div className="mt-[var(--s-5)] flex flex-col gap-[var(--s-2)]">
          <h3 className="text-[var(--step--1)] uppercase tracking-wide text-[var(--dust)]">Contradictions</h3>
          <ContradictionsPanel />
        </div>
        <div className="mt-[var(--s-5)] flex flex-col gap-[var(--s-2)]">
          <h3 className="text-[var(--step--1)] uppercase tracking-wide text-[var(--dust)]">Trace</h3>
          <TracePanel />
        </div>
      </Column>
    </div>
  );
}

function Column({
  title,
  className = '',
  children,
}: {
  title: string;
  className?: string;
  children?: ReactNode;
}) {
  // Independent per-column scrolling only makes sense once the 3-column
  // desktop grid gives each column a bounded height (md:h-screen on the
  // shell). Below that, the shell is a plain flex-col and the whole page
  // scrolls — three nested scrollboxes stacked on a phone is its own kind
  // of broken (P4).
  return (
    <section className={`bg-[var(--slate-raised)] p-[var(--s-4)] md:h-full md:overflow-y-auto ${className}`}>
      <h2 className="text-[var(--step--1)] uppercase tracking-wide text-[var(--dust)]">{title}</h2>
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
