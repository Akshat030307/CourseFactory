import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraphPanel } from './GraphPanel';
import { useLectures } from '../api/lectures';
import { registerRouterContext } from '../nav/navigate';

// The marketing entry point. Everything on this page is real: real course
// data (useLectures), a real embedded GraphPanel (not a screenshot), real
// cost figures (matches README's own Cost section), and real deep links
// into the app pages built in Stages 0-10 — no fabricated multi-course
// dashboard, no chat UI that isn't backed by anything.
export function LandingPage() {
  const routerNavigate = useNavigate();
  const { data: lectures } = useLectures();

  // GraphPanel's concept-node clicks go through nav/navigate.ts, which
  // needs router context registered the same way AppShell does — there's
  // no "current lecture" here, so every click is correctly cross-lecture
  // (routes straight into the app at that concept's moment).
  useEffect(() => {
    registerRouterContext((path) => routerNavigate(path), null);
    return () => registerRouterContext(null, null);
  }, [routerNavigate]);

  const firstLecture = lectures?.[0]?.id ?? 'l01';

  return (
    <div className="min-h-screen bg-[var(--slate)] text-[var(--chalk)]">
      <Nav />
      <Hero firstLecture={firstLecture} />
      <Differentiators />
      <DemoMoments firstLecture={firstLecture} />
      <HowItWorks />
      <GraphPreview />
      <Cost />
      <Distribution />
      <FooterCta firstLecture={firstLecture} />
    </div>
  );
}

function Nav() {
  return (
    <header className="flex items-center justify-between border-b border-[var(--slate-line)] px-[var(--s-5)] py-[var(--s-3)]">
      <Link to="/" className="font-[var(--font-display)] text-[var(--step-1)] tracking-tight">
        Course<span className="text-[var(--written)]">Factory</span>
      </Link>
      <nav className="flex items-center gap-[var(--s-4)] text-[var(--step--1)]">
        <Link to="/course/18.06" className="text-[var(--dust)] hover:text-[var(--chalk)]">
          Dashboard
        </Link>
        <Link to="/drill" className="text-[var(--dust)] hover:text-[var(--chalk)]">
          Due reviews
        </Link>
        <Link to="/review" className="text-[var(--dust)] hover:text-[var(--chalk)]">
          Instructor queue
        </Link>
        <Link
          to="/lecture/l01"
          className="rounded-[var(--radius)] bg-[var(--written)] px-[var(--s-3)] py-[var(--s-1)] text-[var(--slate)] font-medium hover:opacity-90"
        >
          Try the Demo
        </Link>
      </nav>
    </header>
  );
}

function Hero({ firstLecture }: { firstLecture: string }) {
  return (
    <section className="mx-auto flex max-w-4xl flex-col items-start gap-[var(--s-4)] px-[var(--s-5)] py-[var(--s-6)]">
      <span className="rounded-full border border-[var(--slate-line)] px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--dust)]">
        Built on RocketRide · runs entirely on localhost
      </span>
      <h1 className="font-[var(--font-display)] text-[2.6rem] leading-tight md:text-[3.2rem]">
        Upload a lecture.
        <br />
        Get a course that knows what
        <br />
        <span className="text-[var(--written)]">you don't understand yet.</span>
      </h1>
      <p className="max-w-2xl text-[var(--step-0)] text-[var(--dust)]">
        We read the board, reason across lectures, and send you to the exact ninety seconds —
        often in a <em>different</em> lecture — that fixes it.
      </p>
      <div className="flex gap-[var(--s-3)]">
        <Link
          to={`/lecture/${firstLecture}`}
          className="rounded-[var(--radius)] bg-[var(--written)] px-[var(--s-4)] py-[var(--s-2)] text-[var(--slate)] font-medium hover:opacity-90"
        >
          Try the Demo
        </Link>
        <a
          href="#how-it-works"
          className="rounded-[var(--radius)] border border-[var(--slate-line)] px-[var(--s-4)] py-[var(--s-2)] text-[var(--chalk)] hover:bg-[var(--slate-raised)]"
        >
          See How It Works
        </a>
      </div>
      <div className="flex gap-[var(--s-4)] text-[var(--step--1)] text-[var(--dust)]">
        <span>⏵ Runs locally</span>
        <span>⏵ ~1.5¢ per lecture</span>
        <span>⏵ No model downloads</span>
      </div>
    </section>
  );
}

function Differentiators() {
  const items = [
    {
      title: 'Reads the board',
      body: 'Finds content that was written on the board but never spoken aloud — a normal transcript search can’t see it.',
    },
    {
      title: 'Reasons across lectures',
      body: 'A prerequisite graph spanning the whole course, not one document at a time.',
    },
    {
      title: 'Diagnoses, not repeats',
      body: 'Fail a Lecture 4 question, get sent to the actual gap in Lecture 2 — not just "try again."',
    },
  ];
  return (
    <section className="border-t border-[var(--slate-line)] px-[var(--s-5)] py-[var(--s-6)]">
      <h2 className="mb-[var(--s-4)] text-center font-[var(--font-display)] text-[var(--step-2)]">
        What makes it different
      </h2>
      <div className="mx-auto grid max-w-5xl gap-[var(--s-4)] md:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className="rounded-[var(--radius-lg)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-4)]">
            <h3 className="mb-[var(--s-2)] text-[var(--step-1)] text-[var(--written)]">{it.title}</h3>
            <p className="text-[var(--step--1)] text-[var(--dust)]">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DemoMoments({ firstLecture }: { firstLecture: string }) {
  const moments = [
    {
      n: '01',
      title: 'Board-only search',
      body: 'Finds a term that was never spoken aloud.',
      to: `/lecture/${firstLecture}`,
      hint: 'Try the Written lane, search "column picture"',
    },
    {
      n: '02',
      title: 'Mid-derivation hit',
      body: 'A conceptual query lands mid-derivation, not on a summary.',
      to: `/lecture/${firstLecture}`,
      hint: 'Try "elimination" on the Both lane',
    },
    {
      n: '03',
      title: 'Cross-lecture diagnosis',
      body: 'A failed quiz question sends the student back a lecture.',
      to: '/lecture/l04',
      hint: 'Answer the LU Factorization question wrong',
    },
    {
      n: '04',
      title: 'Everywhere',
      body: 'Works on Telegram and inside Claude Desktop (MCP), same course data.',
      to: '#distribution',
      hint: 'Scan the QR below',
    },
  ];
  return (
    <section className="border-t border-[var(--slate-line)] px-[var(--s-5)] py-[var(--s-6)]">
      <h2 className="mb-[var(--s-4)] text-center font-[var(--font-display)] text-[var(--step-2)]">
        Four demo moments
      </h2>
      <div className="mx-auto grid max-w-5xl gap-[var(--s-3)] md:grid-cols-4">
        {moments.map((m) =>
          m.to.startsWith('#') ? (
            <a
              key={m.n}
              href={m.to}
              className="flex flex-col gap-[var(--s-1)] rounded-[var(--radius)] border border-[var(--slate-line)] p-[var(--s-3)] hover:bg-[var(--slate-raised)]"
            >
              <MomentBody m={m} />
            </a>
          ) : (
            <Link
              key={m.n}
              to={m.to}
              className="flex flex-col gap-[var(--s-1)] rounded-[var(--radius)] border border-[var(--slate-line)] p-[var(--s-3)] hover:bg-[var(--slate-raised)]"
            >
              <MomentBody m={m} />
            </Link>
          ),
        )}
      </div>
    </section>
  );
}

function MomentBody({ m }: { m: { n: string; title: string; body: string; hint: string } }) {
  return (
    <>
      <span className="ts text-[var(--written)]">{m.n}</span>
      <h3 className="text-[var(--step-0)]">{m.title}</h3>
      <p className="text-[var(--step--1)] text-[var(--dust)]">{m.body}</p>
      <p className="mt-[var(--s-1)] text-[var(--step--1)] text-[var(--path)]">{m.hint} →</p>
    </>
  );
}

function HowItWorks() {
  const steps = [
    { n: 1, title: 'Upload', body: 'Drop a lecture. We handle the rest.' },
    { n: 2, title: 'Understand', body: 'Transcribe, read the board, detect concepts.' },
    { n: 3, title: 'Build knowledge', body: 'Create a course graph and prerequisite map.' },
    { n: 4, title: 'Diagnose & guide', body: 'Find gaps. Send students to the exact fix.' },
  ];
  return (
    <section id="how-it-works" className="border-t border-[var(--slate-line)] px-[var(--s-5)] py-[var(--s-6)]">
      <h2 className="mb-[var(--s-4)] text-center font-[var(--font-display)] text-[var(--step-2)]">How it works</h2>
      <div className="mx-auto flex max-w-5xl flex-col gap-[var(--s-3)] md:flex-row md:items-start">
        {steps.map((s, i) => (
          <div key={s.n} className="flex flex-1 items-start gap-[var(--s-3)] md:flex-col">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--written)] text-[var(--written)]">
              {s.n}
            </span>
            <div>
              <h3 className="text-[var(--step-0)]">{s.title}</h3>
              <p className="text-[var(--step--1)] text-[var(--dust)]">{s.body}</p>
            </div>
            {i < steps.length - 1 && <span className="hidden text-[var(--dust)] md:block">→</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function GraphPreview() {
  return (
    <section className="border-t border-[var(--slate-line)] px-[var(--s-5)] py-[var(--s-6)]">
      <h2 className="mb-[var(--s-1)] text-center font-[var(--font-display)] text-[var(--step-2)]">
        The prerequisite graph, live
      </h2>
      <p className="mb-[var(--s-4)] text-center text-[var(--step--1)] text-[var(--dust)]">
        This is the real course graph — click a concept to jump straight into the lecture that teaches it.
      </p>
      <div className="mx-auto max-w-3xl rounded-[var(--radius-lg)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-4)]">
        <GraphPanel />
      </div>
    </section>
  );
}

function Cost() {
  const rows = [
    { label: 'Transcription', value: 'Free (Groq)' },
    { label: 'Frames & OCR', value: 'Free (local)' },
    { label: 'Vision', value: 'Free (Groq)' },
    { label: 'Analysis', value: '~$0.013 (OpenAI nano)' },
    { label: 'Embeddings', value: '~$0.001 (OpenAI)' },
  ];
  return (
    <section className="border-t border-[var(--slate-line)] px-[var(--s-5)] py-[var(--s-6)]">
      <h2 className="mb-[var(--s-1)] text-center font-[var(--font-display)] text-[var(--step-2)]">
        Costs <span className="text-[var(--written)]">~1.5¢</span> per lecture
      </h2>
      <div className="mx-auto mt-[var(--s-4)] grid max-w-3xl gap-[var(--s-3)] sm:grid-cols-5">
        {rows.map((r) => (
          <div key={r.label} className="rounded-[var(--radius)] border border-[var(--slate-line)] p-[var(--s-2)] text-center">
            <p className="text-[var(--step--1)] text-[var(--dust)]">{r.label}</p>
            <p className="ts mt-[var(--s-1)]">{r.value}</p>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-[var(--s-4)] max-w-2xl text-center text-[var(--step--1)] text-[var(--dust)]">
        No ML model weights load locally — not to save memory, but to save setup time. A torch
        install and a multi-gigabyte model download is two hours that buys nothing the demo needs.
      </p>
    </section>
  );
}

function Distribution() {
  const claudeConfig = `{
  "mcpServers": {
    "course-factory": {
      "command": "python",
      "args": ["scripts/mcp_server.py"]
    }
  }
}`;
  return (
    <section id="distribution" className="border-t border-[var(--slate-line)] px-[var(--s-5)] py-[var(--s-6)]">
      <h2 className="mb-[var(--s-4)] text-center font-[var(--font-display)] text-[var(--step-2)]">
        Turn any lecture into your smartest teacher
      </h2>
      <div className="mx-auto grid max-w-4xl gap-[var(--s-4)] md:grid-cols-2">
        <div className="rounded-[var(--radius-lg)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-4)]">
          <h3 className="mb-[var(--s-2)] text-[var(--step-0)]">Telegram bot</h3>
          <p className="mb-[var(--s-3)] text-[var(--step--1)] text-[var(--dust)]">
            Long polling, so it works from localhost with no tunnel. Scan to ask questions and take
            due reviews from your phone.
          </p>
          <img
            src="/media/telegram_bot_qr.png"
            alt="Scan to open the Course Factory Telegram bot"
            className="h-32 w-32 rounded-[var(--radius)] bg-white p-[var(--s-2)]"
          />
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--slate-line)] bg-[var(--slate-raised)] p-[var(--s-4)]">
          <h3 className="mb-[var(--s-2)] text-[var(--step-0)]">MCP in Claude Desktop</h3>
          <p className="mb-[var(--s-3)] text-[var(--step--1)] text-[var(--dust)]">
            Search, explain, and find prerequisites — from inside Claude Desktop, backed by the same
            transcript and board data. Add to <code className="ts">claude_desktop_config.json</code>:
          </p>
          <pre className="overflow-x-auto rounded-[var(--radius)] bg-[var(--slate)] p-[var(--s-2)] text-[var(--step--1)] text-[var(--chalk)]">
            <code>{claudeConfig}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}

function FooterCta({ firstLecture }: { firstLecture: string }) {
  return (
    <footer className="border-t border-[var(--slate-line)] px-[var(--s-5)] py-[var(--s-6)] text-center">
      <div className="flex justify-center gap-[var(--s-5)] text-[var(--step--1)] text-[var(--dust)]">
        <span>✓ No model downloads</span>
        <span>✓ Runs locally</span>
        <span>✓ Built for speed. Built for learning.</span>
      </div>
      <Link
        to={`/lecture/${firstLecture}`}
        className="mt-[var(--s-4)] inline-block rounded-[var(--radius)] bg-[var(--written)] px-[var(--s-5)] py-[var(--s-2)] text-[var(--slate)] font-medium hover:opacity-90"
      >
        Get Started for Free
      </Link>
    </footer>
  );
}
