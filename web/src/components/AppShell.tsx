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
import { useActiveContradiction } from '../contradictions/activeContradiction';
import { registerRouterContext } from '../nav/navigate';

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

  const tParam = searchParams.get('t');
  const initialSeekMs = tParam !== null ? Number(tParam) : undefined;

  return (
    <div className="grid h-screen grid-cols-[240px_1fr_360px] grid-rows-[56px_1fr]">
      <ReturnPill />
      <header className="col-span-3 flex items-center justify-between border-b border-[var(--slate-line)] px-[var(--s-4)]">
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

      <Column title="Course" className="border-r border-[var(--slate-line)]">
        {/* CourseRail: lecture list, mastery dots, upload — Stage 1 */}
      </Column>

      <Column title="Stage">
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
          <p className="text-[var(--dust)]">Select a lecture from the course rail.</p>
        )}
      </Column>

      <Column title="Inspector" className="border-l border-[var(--slate-line)]">
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
  return (
    <section className={`overflow-y-auto bg-[var(--slate-raised)] p-[var(--s-4)] ${className}`}>
      <h2 className="text-[var(--step--1)] uppercase tracking-wide text-[var(--dust)]">{title}</h2>
      {children}
    </section>
  );
}
