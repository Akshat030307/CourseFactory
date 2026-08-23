import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLectures } from '../api/lectures';

// Stage 12: the whole app now shares this black-and-gold palette (was
// scoped to just this page before) — these read the real tokens.css
// values instead of duplicating them, so there's one source of truth.
const GOLD = 'var(--written)';
const GOLD_DIM = 'var(--written-dim)';
const CREAM = 'var(--chalk)';
const BLACK = 'var(--slate)';
const PANEL = 'var(--slate-raised)';
const LINE = 'var(--slate-line)';

// Scroll-reveal: fades/slides a section in once it enters the viewport.
// Plain IntersectionObserver, no animation library — consistent with how
// the rest of this app hand-rolls its one existing animation (tokens.css's
// remediation-in keyframe). prefers-reduced-motion is handled for free by
// tokens.css's existing global override, since this still just drives a
// CSS transition/animation-duration.
function Reveal({ children, delayMs = 0 }: { children: ReactNode; delayMs?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity 700ms ease ${delayMs}ms, transform 700ms ease ${delayMs}ms`,
      }}
    >
      {children}
    </div>
  );
}

export function LandingPage() {
  const { data: lectures } = useLectures();
  const firstLecture = lectures?.[0]?.id ?? 'l01';

  return (
    <div style={{ background: BLACK, color: CREAM, minHeight: '100vh' }}>
      <style>{`
        @keyframes lp-glow-drift {
          0%, 100% { transform: translate(-10%, -10%) scale(1); opacity: 0.5; }
          50% { transform: translate(5%, 5%) scale(1.15); opacity: 0.8; }
        }
        @keyframes lp-fade-in-up {
          from { opacity: 0; transform: translateY(28px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .lp-hero-glow {
          position: absolute; inset: -20% -10% auto -10%; height: 600px;
          background: radial-gradient(circle, rgba(224,184,76,0.22) 0%, rgba(224,184,76,0) 70%);
          animation: lp-glow-drift 14s ease-in-out infinite;
          pointer-events: none;
        }
        .lp-hero-item {
          opacity: 0;
          animation: lp-fade-in-up 800ms ease forwards;
        }
        .lp-card {
          transition: transform 220ms ease, border-color 220ms ease, box-shadow 220ms ease;
        }
        .lp-card:hover {
          transform: translateY(-4px);
          border-color: ${GOLD};
          box-shadow: 0 8px 30px rgba(224,184,76,0.15);
        }
        .lp-btn { transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease; }
        .lp-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(224,184,76,0.35); }
        .lp-link { transition: color 180ms ease; }
      `}</style>

      <Nav />
      <Hero firstLecture={firstLecture} />
      <Reveal>
        <Differentiators />
      </Reveal>
      <Reveal>
        <DemoMoments firstLecture={firstLecture} />
      </Reveal>
      <Reveal>
        <HowItWorks />
      </Reveal>
      <Reveal>
        <Cost />
      </Reveal>
      <Reveal>
        <Distribution />
      </Reveal>
      <Reveal>
        <FooterCta firstLecture={firstLecture} />
      </Reveal>
    </div>
  );
}

function Nav() {
  return (
    <header
      className="flex items-center justify-between px-[var(--s-5)] py-[var(--s-3)]"
      style={{ borderBottom: `1px solid ${LINE}` }}
    >
      <Link to="/" className="font-[var(--font-display)] text-[var(--step-1)] tracking-tight" style={{ color: GOLD }}>
        Course<span style={{ color: CREAM }}>Factory</span>
      </Link>
      <nav className="flex items-center gap-[var(--s-4)] text-[var(--step--1)]">
        <Link to="/course/18.06" className="lp-link" style={{ color: CREAM }}>
          Dashboard
        </Link>
        <Link to="/drill" className="lp-link" style={{ color: CREAM }}>
          Due reviews
        </Link>
        <Link to="/review" className="lp-link" style={{ color: CREAM }}>
          Instructor queue
        </Link>
        <Link to="/upload" className="lp-link" style={{ color: CREAM }}>
          Upload
        </Link>
        <Link
          to="/lecture/l01"
          className="lp-btn rounded-[var(--radius)] px-[var(--s-3)] py-[var(--s-1)] font-medium"
          style={{ background: GOLD, color: BLACK }}
        >
          Try the Demo
        </Link>
      </nav>
    </header>
  );
}

function Hero({ firstLecture }: { firstLecture: string }) {
  return (
    <section className="relative mx-auto flex max-w-4xl flex-col items-start gap-[var(--s-4)] overflow-hidden px-[var(--s-5)] py-[var(--s-6)]">
      <div className="lp-hero-glow" />
      <span
        className="lp-hero-item rounded-full px-[var(--s-2)] py-[var(--s-1)] text-[var(--step--1)]"
        style={{ border: `1px solid ${LINE}`, color: GOLD_DIM, animationDelay: '0ms' }}
      >
        Built on RocketRide · runs entirely on localhost
      </span>
      <h1
        className="lp-hero-item font-[var(--font-display)] text-[2.6rem] leading-tight md:text-[3.2rem]"
        style={{ color: GOLD, animationDelay: '80ms' }}
      >
        Upload a lecture.
        <br />
        Get a course that knows what
        <br />
        <span style={{ color: CREAM }}>you don't understand yet.</span>
      </h1>
      <p
        className="lp-hero-item max-w-2xl text-[var(--step-0)]"
        style={{ color: CREAM, opacity: 0.85, animationDelay: '160ms' }}
      >
        We read the board, reason across lectures, and send you to the exact ninety seconds —
        often in a <em>different</em> lecture — that fixes it.
      </p>
      <div className="lp-hero-item flex flex-wrap gap-[var(--s-3)]" style={{ animationDelay: '240ms' }}>
        <Link
          to="/upload"
          className="lp-btn rounded-[var(--radius)] px-[var(--s-4)] py-[var(--s-2)] font-medium"
          style={{ background: GOLD, color: BLACK }}
        >
          Upload Your Lecture
        </Link>
        <Link
          to={`/lecture/${firstLecture}`}
          className="lp-btn rounded-[var(--radius)] px-[var(--s-4)] py-[var(--s-2)]"
          style={{ border: `1px solid ${GOLD_DIM}`, color: GOLD }}
        >
          Try the Demo
        </Link>
        <a
          href="#how-it-works"
          className="lp-btn rounded-[var(--radius)] px-[var(--s-4)] py-[var(--s-2)]"
          style={{ border: `1px solid ${LINE}`, color: CREAM }}
        >
          See How It Works
        </a>
      </div>
      <div
        className="lp-hero-item flex gap-[var(--s-4)] text-[var(--step--1)]"
        style={{ color: GOLD_DIM, animationDelay: '320ms' }}
      >
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
    <section className="px-[var(--s-5)] py-[var(--s-6)]" style={{ borderTop: `1px solid ${LINE}` }}>
      <h2 className="mb-[var(--s-4)] text-center font-[var(--font-display)] text-[var(--step-2)]" style={{ color: GOLD }}>
        What makes it different
      </h2>
      <div className="mx-auto grid max-w-5xl gap-[var(--s-4)] md:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.title}
            className="lp-card rounded-[var(--radius-lg)] p-[var(--s-4)]"
            style={{ border: `1px solid ${LINE}`, background: PANEL }}
          >
            <h3 className="mb-[var(--s-2)] text-[var(--step-1)]" style={{ color: GOLD }}>
              {it.title}
            </h3>
            <p className="text-[var(--step--1)]" style={{ color: CREAM, opacity: 0.75 }}>
              {it.body}
            </p>
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
    <section className="px-[var(--s-5)] py-[var(--s-6)]" style={{ borderTop: `1px solid ${LINE}` }}>
      <h2 className="mb-[var(--s-4)] text-center font-[var(--font-display)] text-[var(--step-2)]" style={{ color: GOLD }}>
        Four demo moments
      </h2>
      <div className="mx-auto grid max-w-5xl gap-[var(--s-3)] md:grid-cols-4">
        {moments.map((m) =>
          m.to.startsWith('#') ? (
            <a key={m.n} href={m.to} className="lp-card flex flex-col gap-[var(--s-1)] rounded-[var(--radius)] p-[var(--s-3)]" style={{ border: `1px solid ${LINE}` }}>
              <MomentBody m={m} />
            </a>
          ) : (
            <Link key={m.n} to={m.to} className="lp-card flex flex-col gap-[var(--s-1)] rounded-[var(--radius)] p-[var(--s-3)]" style={{ border: `1px solid ${LINE}` }}>
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
      <span className="ts" style={{ color: GOLD }}>
        {m.n}
      </span>
      <h3 className="text-[var(--step-0)]" style={{ color: CREAM }}>
        {m.title}
      </h3>
      <p className="text-[var(--step--1)]" style={{ color: CREAM, opacity: 0.7 }}>
        {m.body}
      </p>
      <p className="mt-[var(--s-1)] text-[var(--step--1)]" style={{ color: GOLD }}>
        {m.hint} →
      </p>
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
    <section id="how-it-works" className="px-[var(--s-5)] py-[var(--s-6)]" style={{ borderTop: `1px solid ${LINE}` }}>
      <h2 className="mb-[var(--s-4)] text-center font-[var(--font-display)] text-[var(--step-2)]" style={{ color: GOLD }}>
        How it works
      </h2>
      <div className="mx-auto flex max-w-5xl flex-col gap-[var(--s-3)] md:flex-row md:items-start">
        {steps.map((s) => (
          <div key={s.n} className="flex flex-1 items-start gap-[var(--s-3)] md:flex-col">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ border: `1px solid ${GOLD}`, color: GOLD }}
            >
              {s.n}
            </span>
            <div>
              <h3 className="text-[var(--step-0)]" style={{ color: CREAM }}>
                {s.title}
              </h3>
              <p className="text-[var(--step--1)]" style={{ color: CREAM, opacity: 0.7 }}>
                {s.body}
              </p>
            </div>
          </div>
        ))}
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
    <section className="px-[var(--s-5)] py-[var(--s-6)]" style={{ borderTop: `1px solid ${LINE}` }}>
      <h2 className="mb-[var(--s-1)] text-center font-[var(--font-display)] text-[var(--step-2)]" style={{ color: CREAM }}>
        Costs <span style={{ color: GOLD }}>~1.5¢</span> per lecture
      </h2>
      <div className="mx-auto mt-[var(--s-4)] grid max-w-3xl gap-[var(--s-3)] sm:grid-cols-5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="lp-card rounded-[var(--radius)] p-[var(--s-2)] text-center"
            style={{ border: `1px solid ${LINE}` }}
          >
            <p className="text-[var(--step--1)]" style={{ color: CREAM, opacity: 0.6 }}>
              {r.label}
            </p>
            <p className="ts mt-[var(--s-1)]" style={{ color: GOLD }}>
              {r.value}
            </p>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-[var(--s-4)] max-w-2xl text-center text-[var(--step--1)]" style={{ color: CREAM, opacity: 0.55 }}>
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
    <section id="distribution" className="px-[var(--s-5)] py-[var(--s-6)]" style={{ borderTop: `1px solid ${LINE}` }}>
      <h2 className="mb-[var(--s-4)] text-center font-[var(--font-display)] text-[var(--step-2)]" style={{ color: GOLD }}>
        Turn any lecture into your smartest teacher
      </h2>
      <div className="mx-auto grid max-w-4xl gap-[var(--s-4)] md:grid-cols-2">
        <div className="lp-card rounded-[var(--radius-lg)] p-[var(--s-4)]" style={{ border: `1px solid ${LINE}`, background: PANEL }}>
          <h3 className="mb-[var(--s-2)] text-[var(--step-0)]" style={{ color: GOLD }}>
            Telegram bot
          </h3>
          <p className="mb-[var(--s-3)] text-[var(--step--1)]" style={{ color: CREAM, opacity: 0.75 }}>
            Long polling, so it works from localhost with no tunnel. Scan to ask questions and take
            due reviews from your phone.
          </p>
          <img
            src="/media/public/telegram_bot_qr.png"
            alt="Scan to open the Course Factory Telegram bot"
            className="h-32 w-32 rounded-[var(--radius)] bg-white p-[var(--s-2)]"
          />
        </div>
        <div className="lp-card rounded-[var(--radius-lg)] p-[var(--s-4)]" style={{ border: `1px solid ${LINE}`, background: PANEL }}>
          <h3 className="mb-[var(--s-2)] text-[var(--step-0)]" style={{ color: GOLD }}>
            MCP in Claude Desktop
          </h3>
          <p className="mb-[var(--s-3)] text-[var(--step--1)]" style={{ color: CREAM, opacity: 0.75 }}>
            Search, explain, and find prerequisites — from inside Claude Desktop, backed by the same
            transcript and board data. Add to <code className="ts">claude_desktop_config.json</code>:
          </p>
          <pre className="overflow-x-auto rounded-[var(--radius)] p-[var(--s-2)] text-[var(--step--1)]" style={{ background: BLACK, color: CREAM }}>
            <code>{claudeConfig}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}

function FooterCta({ firstLecture }: { firstLecture: string }) {
  return (
    <footer className="px-[var(--s-5)] py-[var(--s-6)] text-center" style={{ borderTop: `1px solid ${LINE}` }}>
      <div className="flex flex-wrap justify-center gap-[var(--s-5)] text-[var(--step--1)]" style={{ color: CREAM, opacity: 0.6 }}>
        <span>✓ No model downloads</span>
        <span>✓ Runs locally</span>
        <span>✓ Built for speed. Built for learning.</span>
      </div>
      <Link
        to={`/lecture/${firstLecture}`}
        className="lp-btn mt-[var(--s-4)] inline-block rounded-[var(--radius)] px-[var(--s-5)] py-[var(--s-2)] font-medium"
        style={{ background: GOLD, color: BLACK }}
      >
        Get Started for Free
      </Link>
    </footer>
  );
}
