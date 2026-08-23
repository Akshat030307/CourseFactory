import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../api/auth';
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
const EASE = 'var(--ease)';
const MONO = 'var(--font-mono)';

// Two intentional widths instead of five ad-hoc ones — a "reading column"
// for prose-heavy sections and a wider "grid column" for card layouts, used
// consistently so the page reads as one composition rather than a stack of
// independently-sized sections.
const NARROW = 'max-w-3xl';
const WIDE = 'max-w-5xl';

// Scroll-reveal: fades/slides an element in once it enters the viewport.
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
      // min-w-0 h-full: Reveal is the actual direct flex/grid item wherever
      // it wraps a card (its child is a grandchild, not the item) — without
      // this, IT (not the card inside it) hits the grid's automatic
      // min-content floor, which silently defeats any min-w-0 the card
      // itself has. h-full lets height: 100% cards (equal-height rows)
      // pass through a definite height instead of collapsing to content.
      className="h-full min-w-0"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        transition: `opacity 700ms ${EASE} ${delayMs}ms, transform 700ms ${EASE} ${delayMs}ms`,
      }}
    >
      {children}
    </div>
  );
}

// A hairline that fades at both edges instead of a hard-stopped border —
// reads as an intentional seam between sections rather than a template's
// flat divider. Purely decorative, replaces every section's old
// `borderTop: 1px solid LINE`.
function Divider() {
  return <div aria-hidden style={{ height: 1, background: `linear-gradient(90deg, transparent, ${LINE}, transparent)` }} />;
}


export function LandingPage() {
  const { data: lectures } = useLectures();
  const firstLecture = lectures?.[0]?.id ?? 'l01';
  // Stage 14: still invite-only (no self-service signup — see
  // CLAUDE.md), so an anonymous visitor clicking straight into
  // /course/18.06 or /upload just bounces off RequireAuth's redirect to
  // /login. Checking auth state here means the nav/hero can point them at
  // something they can actually do instead — /signup if they don't have a
  // login, straight into the app if they do.
  const { data: me } = useMe();
  const authenticated = me?.authenticated ?? false;

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
        @keyframes lp-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .lp-hero-glow {
          position: absolute; inset: -20% -10% auto -10%; height: 600px;
          background: radial-gradient(circle, rgba(224,184,76,0.16) 0%, rgba(224,184,76,0) 70%);
          animation: lp-glow-drift 16s ease-in-out infinite;
          pointer-events: none;
        }
        .lp-section-glow {
          position: absolute; inset: auto -10% -20% -10%; height: 480px;
          background: radial-gradient(circle, rgba(224,184,76,0.07) 0%, rgba(224,184,76,0) 70%);
          pointer-events: none;
        }
        .lp-hero-item {
          opacity: 0;
          animation: lp-fade-in-up 900ms ${EASE} forwards;
        }
        .lp-dot {
          animation: lp-pulse 2.4s ease-in-out infinite;
        }
        .lp-card {
          transition: transform 260ms ${EASE}, border-color 260ms ${EASE}, box-shadow 260ms ${EASE}, background 260ms ${EASE};
        }
        .lp-card:hover {
          transform: translateY(-4px);
          border-color: ${GOLD_DIM};
          box-shadow: 0 16px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(224,184,76,0.08);
        }
        .lp-btn {
          transition: transform 220ms ${EASE}, box-shadow 220ms ${EASE}, opacity 220ms ${EASE}, border-color 220ms ${EASE}, background 220ms ${EASE};
        }
        .lp-btn-solid:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(224,184,76,0.3); }
        .lp-btn-outline:hover { transform: translateY(-2px); border-color: ${GOLD} !important; background: rgba(224,184,76,0.06); }
        .lp-btn-ghost:hover { border-color: ${GOLD_DIM} !important; color: ${CREAM} !important; }
        .lp-link { transition: color 200ms ${EASE}, opacity 200ms ${EASE}; opacity: 0.82; }
        .lp-link:hover { opacity: 1; }
        .lp-nav {
          position: sticky; top: 0; z-index: 50;
          background: rgba(0,0,0,0.72);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
      `}</style>

      <Nav authenticated={authenticated} />
      <Hero firstLecture={firstLecture} authenticated={authenticated} />
      <Differentiators />
      <DemoMoments firstLecture={firstLecture} />
      <HowItWorks />
      <Cost />
      <Distribution />
      <FooterCta firstLecture={firstLecture} authenticated={authenticated} />
    </div>
  );
}

function Nav({ authenticated }: { authenticated: boolean }) {
  return (
    <header className="lp-nav flex items-center justify-between px-[var(--s-5)] py-[var(--s-3)]" style={{ borderBottom: `1px solid ${LINE}` }}>
      <Link to="/" className="font-[var(--font-display)] text-[var(--step-1)] tracking-tight" style={{ color: GOLD }}>
        Course<span style={{ color: CREAM }}>Factory</span>
      </Link>
      <nav className="flex items-center gap-[var(--s-4)] text-[var(--step--1)]">
        {authenticated ? (
          <>
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
            <Link to="/waitlist" className="lp-link" style={{ color: CREAM }}>
              Waitlist
            </Link>
            <Link
              to="/lecture/l01"
              className="lp-btn lp-btn-solid rounded-[var(--radius)] px-[var(--s-3)] py-[var(--s-1)] font-medium"
              style={{ background: GOLD, color: BLACK }}
            >
              Open App
            </Link>
          </>
        ) : (
          <>
            <Link to="/login" className="lp-link" style={{ color: CREAM }}>
              Log In
            </Link>
            <Link
              to="/signup"
              className="lp-btn lp-btn-solid rounded-[var(--radius)] px-[var(--s-3)] py-[var(--s-1)] font-medium"
              style={{ background: GOLD, color: BLACK }}
            >
              Join Waitlist
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

function Hero({ firstLecture, authenticated }: { firstLecture: string; authenticated: boolean }) {
  return (
    <section className="relative mx-auto flex max-w-4xl flex-col items-start gap-[var(--s-5)] overflow-hidden px-[var(--s-5)] py-24 md:py-36">
      <div className="lp-hero-glow" />
      <span
        className="lp-hero-item relative z-10 flex items-center gap-[var(--s-2)] rounded-[var(--radius)] px-[var(--s-3)] py-[var(--s-1)] text-[var(--step--1)] tracking-[0.02em]"
        style={{ border: `1px solid ${LINE}`, color: GOLD_DIM, fontFamily: MONO, animationDelay: '0ms' }}
      >
        <span className="lp-dot inline-block h-[6px] w-[6px] rounded-full" style={{ background: GOLD }} />
        Built on RocketRide · runs entirely on localhost
      </span>
      <h1
        className="lp-hero-item relative z-10 font-[var(--font-display)] text-[2.7rem] leading-[1.08] tracking-[-0.01em] md:text-[3.6rem] lg:text-[4.4rem]"
        style={{ color: GOLD, animationDelay: '100ms' }}
      >
        Upload a lecture.
        <br />
        Get a course that knows what
        <br />
        <span style={{ color: CREAM }}>you don't understand yet.</span>
      </h1>
      <p
        className="lp-hero-item relative z-10 max-w-2xl text-[var(--step-1)] leading-relaxed"
        style={{ color: CREAM, opacity: 0.82, animationDelay: '200ms' }}
      >
        We read the board, reason across lectures, and send you to the exact ninety seconds —
        often in a <em>different</em> lecture — that fixes it.
      </p>
      <div className="lp-hero-item relative z-10 flex flex-wrap gap-[var(--s-3)]" style={{ animationDelay: '300ms' }}>
        {authenticated ? (
          <>
            <Link
              to="/upload"
              className="lp-btn lp-btn-solid rounded-[var(--radius)] px-[var(--s-4)] py-[var(--s-2)] font-medium"
              style={{ background: GOLD, color: BLACK }}
            >
              Upload Your Lecture
            </Link>
            <Link
              to={`/lecture/${firstLecture}`}
              className="lp-btn lp-btn-outline rounded-[var(--radius)] px-[var(--s-4)] py-[var(--s-2)]"
              style={{ border: `1px solid ${GOLD_DIM}`, color: GOLD }}
            >
              Open the App
            </Link>
          </>
        ) : (
          <>
            <Link
              to="/signup"
              className="lp-btn lp-btn-solid rounded-[var(--radius)] px-[var(--s-4)] py-[var(--s-2)] font-medium"
              style={{ background: GOLD, color: BLACK }}
            >
              Join the Waitlist
            </Link>
            <Link
              to="/login"
              className="lp-btn lp-btn-outline rounded-[var(--radius)] px-[var(--s-4)] py-[var(--s-2)]"
              style={{ border: `1px solid ${GOLD_DIM}`, color: GOLD }}
            >
              Log In
            </Link>
          </>
        )}
        <a
          href="#how-it-works"
          className="lp-btn lp-btn-ghost rounded-[var(--radius)] px-[var(--s-4)] py-[var(--s-2)]"
          style={{ border: `1px solid ${LINE}`, color: CREAM }}
        >
          See How It Works
        </a>
      </div>
      <div
        className="lp-hero-item relative z-10 flex flex-wrap gap-[var(--s-3)] pt-[var(--s-2)] text-[var(--step--1)]"
        style={{ animationDelay: '380ms' }}
      >
        {['Runs locally', '~1.5¢ per lecture', 'No model downloads'].map((t) => (
          <span
            key={t}
            className="rounded-[var(--radius)] px-[var(--s-2)] py-[6px]"
            style={{ border: `1px solid ${LINE}`, color: GOLD_DIM, fontFamily: MONO }}
          >
            ⏵ {t}
          </span>
        ))}
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
    <section className="relative px-[var(--s-5)] py-20 md:py-28">
      <Divider />
      <Reveal>
        <h2 className="mb-[var(--s-6)] mt-[var(--s-6)] text-center font-[var(--font-display)] text-[var(--step-3)]" style={{ color: GOLD }}>
          What makes it different
        </h2>
      </Reveal>
      <div className={`mx-auto grid ${WIDE} gap-[var(--s-4)] md:grid-cols-3`}>
        {items.map((it, i) => (
          <Reveal key={it.title} delayMs={i * 90}>
            <div
              className="lp-card relative flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] p-[var(--s-4)]"
              style={{ border: `1px solid ${LINE}`, background: `linear-gradient(160deg, ${PANEL}, ${BLACK})` }}
            >
              <h3 className="relative mb-[var(--s-2)] text-[var(--step-1)]" style={{ color: GOLD }}>
                {it.title}
              </h3>
              <p className="relative text-[var(--step--1)] leading-relaxed" style={{ color: CREAM, opacity: 0.75 }}>
                {it.body}
              </p>
            </div>
          </Reveal>
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
    <section className="relative px-[var(--s-5)] py-20 md:py-28">
      <Divider />
      <Reveal>
        <h2 className="mb-[var(--s-6)] mt-[var(--s-6)] text-center font-[var(--font-display)] text-[var(--step-3)]" style={{ color: GOLD }}>
          Four demo moments
        </h2>
      </Reveal>
      <div className={`mx-auto grid ${WIDE} gap-[var(--s-3)] md:grid-cols-4`}>
        {moments.map((m, i) => {
          const inner = (
            <>
              <span className="ts" style={{ color: GOLD, fontFamily: MONO }}>
                {m.n}
              </span>
              <h3 className="text-[var(--step-0)]" style={{ color: CREAM }}>
                {m.title}
              </h3>
              <p className="text-[var(--step--1)] leading-relaxed" style={{ color: CREAM, opacity: 0.7 }}>
                {m.body}
              </p>
              <p className="mt-auto pt-[var(--s-2)] text-[var(--step--1)]" style={{ color: GOLD }}>
                {m.hint} →
              </p>
            </>
          );
          const cls = 'lp-card flex h-full min-w-0 flex-col gap-[var(--s-1)] rounded-[var(--radius)] p-[var(--s-3)]';
          const sty = { border: `1px solid ${LINE}`, background: PANEL };
          return (
            <Reveal key={m.n} delayMs={i * 80}>
              {m.to.startsWith('#') ? (
                <a href={m.to} className={cls} style={sty}>
                  {inner}
                </a>
              ) : (
                <Link to={m.to} className={cls} style={sty}>
                  {inner}
                </Link>
              )}
            </Reveal>
          );
        })}
      </div>
    </section>
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
    <section id="how-it-works" className="relative px-[var(--s-5)] py-20 md:py-28">
      <Divider />
      <Reveal>
        <h2 className="mb-[var(--s-6)] mt-[var(--s-6)] text-center font-[var(--font-display)] text-[var(--step-3)]" style={{ color: GOLD }}>
          How it works
        </h2>
      </Reveal>
      <div className={`relative mx-auto ${WIDE}`}>
        {/* Horizontal thread behind the numbered markers — desktop only,
            where the four steps sit side by side. Purely decorative: the
            circles get an opaque background so the line reads as passing
            behind, not through, each one. */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-5 hidden md:block"
          style={{ left: '12.5%', right: '12.5%', height: 1, background: `linear-gradient(90deg, transparent, ${GOLD_DIM}, ${GOLD_DIM}, transparent)` }}
        />
        <div className="flex flex-col gap-[var(--s-5)] md:flex-row md:items-start md:gap-[var(--s-3)]">
          {steps.map((s, i) => (
            <Reveal key={s.n} delayMs={i * 100}>
              <div className="relative flex items-start gap-[var(--s-3)] md:flex-1 md:flex-col md:items-center md:text-center">
                {/* Vertical thread between markers — mobile only, where
                    steps stack as rows. */}
                {i < steps.length - 1 && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute left-5 top-10 w-px md:hidden"
                    style={{ height: 'calc(100% + var(--s-5) - 2.5rem)', background: GOLD_DIM }}
                  />
                )}
                <span
                  className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--step--1)]"
                  style={{ border: `1px solid ${GOLD}`, color: GOLD, background: BLACK, fontFamily: MONO }}
                >
                  {s.n}
                </span>
                <div>
                  <h3 className="text-[var(--step-0)]" style={{ color: CREAM }}>
                    {s.title}
                  </h3>
                  <p className="text-[var(--step--1)] leading-relaxed" style={{ color: CREAM, opacity: 0.7 }}>
                    {s.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
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
    <section className="relative px-[var(--s-5)] py-20 md:py-28">
      <Divider />
      <Reveal>
        <h2 className="mb-[var(--s-6)] mt-[var(--s-6)] text-center font-[var(--font-display)] text-[var(--step-3)]" style={{ color: CREAM }}>
          Costs <span style={{ color: GOLD }}>~1.5¢</span> per lecture
        </h2>
      </Reveal>
      <Reveal delayMs={80}>
        <div
          className={`mx-auto grid ${NARROW} divide-y divide-[var(--slate-line)] sm:grid-cols-5 sm:divide-x sm:divide-y-0`}
          style={{ border: `1px solid ${LINE}`, borderRadius: 'var(--radius-lg)', background: PANEL }}
        >
          {rows.map((r) => (
            <div key={r.label} className="p-[var(--s-3)] text-center">
              <p className="text-[10px] tracking-[0.04em]" style={{ color: CREAM, opacity: 0.5, fontFamily: MONO }}>
                {r.label}
              </p>
              <p className="ts mt-[var(--s-2)] text-[var(--step-0)]" style={{ color: GOLD, fontFamily: MONO }}>
                {r.value}
              </p>
            </div>
          ))}
        </div>
      </Reveal>
      <Reveal delayMs={140}>
        <p
          className={`mx-auto mt-[var(--s-5)] ${NARROW} text-center text-[var(--step--1)] leading-relaxed`}
          style={{ color: CREAM, opacity: 0.55, borderLeft: `2px solid ${GOLD_DIM}`, paddingLeft: 'var(--s-3)', textAlign: 'left' }}
        >
          No ML model weights load locally — not to save memory, but to save setup time. A torch
          install and a multi-gigabyte model download is two hours that buys nothing the demo needs.
        </p>
      </Reveal>
    </section>
  );
}

// The claude_desktop_config.json snippet, hand-tokenized for syntax
// contrast instead of a highlighting library (CLAUDE.md: no unnecessary
// dependencies for a static, seven-line JSON literal). Concatenating every
// token in order reproduces the exact original string — this changes only
// color, never a single character of the snippet.
const CONFIG_LINES: { indent: number; parts: { text: string; kind?: 'key' | 'str' }[] }[] = [
  { indent: 0, parts: [{ text: '{' }] },
  { indent: 1, parts: [{ text: '"mcpServers"', kind: 'key' }, { text: ': {' }] },
  { indent: 2, parts: [{ text: '"course-factory"', kind: 'key' }, { text: ': {' }] },
  { indent: 3, parts: [{ text: '"command"', kind: 'key' }, { text: ': ' }, { text: '"python"', kind: 'str' }, { text: ',' }] },
  { indent: 3, parts: [{ text: '"args"', kind: 'key' }, { text: ': [' }, { text: '"scripts/mcp_server.py"', kind: 'str' }, { text: ']' }] },
  { indent: 2, parts: [{ text: '}' }] },
  { indent: 1, parts: [{ text: '}' }] },
  { indent: 0, parts: [{ text: '}' }] },
];

function Distribution() {
  return (
    <section id="distribution" className="relative overflow-hidden px-[var(--s-5)] py-20 md:py-28">
      <Divider />
      <div className="lp-section-glow" />
      <Reveal>
        <h2 className="relative mb-[var(--s-6)] mt-[var(--s-6)] text-center font-[var(--font-display)] text-[var(--step-3)]" style={{ color: GOLD }}>
          Turn any lecture into your smartest teacher
        </h2>
      </Reveal>
      <div className={`relative mx-auto grid ${WIDE.replace('5xl', '4xl')} gap-[var(--s-4)] md:grid-cols-2`}>
        <Reveal delayMs={0}>
          <div
            className="lp-card flex h-full min-w-0 flex-col rounded-[var(--radius-lg)] p-[var(--s-4)]"
            style={{ border: `1px solid ${LINE}`, background: `linear-gradient(160deg, ${PANEL}, ${BLACK})` }}
          >
            <h3 className="mb-[var(--s-2)] text-[var(--step-1)]" style={{ color: GOLD }}>
              Telegram bot
            </h3>
            <p className="mb-[var(--s-3)] text-[var(--step--1)] leading-relaxed" style={{ color: CREAM, opacity: 0.75 }}>
              Long polling, so it works from localhost with no tunnel. Scan to ask questions and take
              due reviews from your phone.
            </p>
            <div
              className="relative mt-auto inline-flex w-fit items-center justify-center rounded-[var(--radius)] p-[var(--s-2)]"
              style={{ border: `1px solid ${GOLD_DIM}`, background: 'rgba(224,184,76,0.04)' }}
            >
              <span aria-hidden className="absolute -left-px -top-px h-3 w-3 border-l-2 border-t-2" style={{ borderColor: GOLD }} />
              <span aria-hidden className="absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2" style={{ borderColor: GOLD }} />
              <img
                src="/media/public/telegram_bot_qr.png"
                alt="Scan to open the Course Factory Telegram bot"
                className="h-28 w-28 rounded-[2px] bg-white p-[var(--s-1)]"
              />
            </div>
          </div>
        </Reveal>
        <Reveal delayMs={100}>
          <div
            className="lp-card flex h-full min-w-0 flex-col rounded-[var(--radius-lg)] p-[var(--s-4)]"
            style={{ border: `1px solid ${LINE}`, background: `linear-gradient(160deg, ${PANEL}, ${BLACK})` }}
          >
            <h3 className="mb-[var(--s-2)] text-[var(--step-1)]" style={{ color: GOLD }}>
              MCP in Claude Desktop
            </h3>
            <p className="mb-[var(--s-3)] text-[var(--step--1)] leading-relaxed" style={{ color: CREAM, opacity: 0.75 }}>
              Search, explain, and find prerequisites — from inside Claude Desktop, backed by the same
              transcript and board data. Add to <code className="ts">claude_desktop_config.json</code>:
            </p>
            <div className="mt-auto overflow-hidden rounded-[var(--radius)]" style={{ border: `1px solid ${LINE}` }}>
              <div
                className="flex items-center gap-[var(--s-2)] px-[var(--s-2)] py-[6px]"
                style={{ background: PANEL, borderBottom: `1px solid ${LINE}` }}
              >
                <span className="flex gap-[5px]">
                  {[GOLD_DIM, LINE, LINE].map((c, i) => (
                    <span key={i} className="h-[8px] w-[8px] rounded-full" style={{ background: c }} />
                  ))}
                </span>
              </div>
              <pre className="overflow-x-auto p-[var(--s-3)] text-[var(--step--1)] leading-relaxed" style={{ background: BLACK, margin: 0 }}>
                <code style={{ fontFamily: MONO }}>
                  {CONFIG_LINES.map((line, i) => (
                    <div key={i}>
                      {'  '.repeat(line.indent)}
                      {line.parts.map((part, j) => (
                        <span
                          key={j}
                          style={{
                            color: part.kind === 'key' ? GOLD : CREAM,
                            opacity: part.kind ? 1 : 0.4,
                          }}
                        >
                          {part.text}
                        </span>
                      ))}
                    </div>
                  ))}
                </code>
              </pre>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FooterCta({ firstLecture, authenticated }: { firstLecture: string; authenticated: boolean }) {
  return (
    <footer className="relative px-[var(--s-5)] py-24 text-center md:py-36" style={{ borderTop: `1px solid ${LINE}` }}>
      <Reveal>
        <div className="flex flex-wrap justify-center gap-[var(--s-5)] text-[var(--step--1)]" style={{ color: CREAM, opacity: 0.55, fontFamily: MONO }}>
          <span>
            <span style={{ color: GOLD }}>✓</span> No model downloads
          </span>
          <span>
            <span style={{ color: GOLD }}>✓</span> Runs locally
          </span>
          <span>
            <span style={{ color: GOLD }}>✓</span> Built for speed. Built for learning.
          </span>
        </div>
      </Reveal>
      <Reveal delayMs={100}>
        <Link
          to={authenticated ? `/lecture/${firstLecture}` : '/signup'}
          className="lp-btn lp-btn-solid mt-[var(--s-6)] inline-block rounded-[var(--radius)] px-[var(--s-6)] py-[var(--s-3)] text-[var(--step-0)] font-medium"
          style={{ background: GOLD, color: BLACK }}
        >
          {authenticated ? 'Open the App' : 'Join the Waitlist'}
        </Link>
      </Reveal>
    </footer>
  );
}
