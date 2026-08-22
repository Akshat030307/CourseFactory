import type { Remediation } from '../api/quiz';
import { navigate } from '../nav/navigate';

interface RemediationCardProps {
  remediation: Remediation;
}

// The app's one orchestrated motion moment (CLAUDE.md) — everywhere else
// stays quiet. `remediation-in` (tokens.css) is a plain CSS animation, so
// the existing global prefers-reduced-motion override already covers it;
// nothing extra to wire here.
export function RemediationCard({ remediation }: RemediationCardProps) {
  if (!remediation.found || !remediation.target) return null;
  const { target } = remediation;

  return (
    <div
      style={{ animation: 'remediation-in var(--dur-remediation) var(--ease)' }}
      className="flex flex-col gap-[var(--s-2)] rounded-[var(--radius)] border border-[var(--path)] bg-[var(--path-dim)] p-[var(--s-3)]"
    >
      <p className="text-[var(--step--1)] uppercase tracking-wide text-[var(--path)]">Before you move on</p>
      <p className="text-[var(--chalk)]">{remediation.reason}</p>
      <button
        onClick={() => navigate(target.lecture_id, target.timestamp_ms)}
        className="self-start rounded-[var(--radius)] bg-[var(--slate)] px-[var(--s-3)] py-[var(--s-1)] text-[var(--step--1)] text-[var(--chalk)] hover:bg-[var(--slate-raised)]"
      >
        Go to {target.lecture_title}
      </button>
    </div>
  );
}
