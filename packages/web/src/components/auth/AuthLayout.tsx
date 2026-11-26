import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import AuthBrand from './AuthBrand';

// Illustrative sample lineup (made-up acts). It shows what Festie is for before sign-in.
const SAMPLE_SETS = [
  { time: '21:30', artist: 'Aurora Lane', stage: 'Main Stage' },
  { time: '22:45', artist: 'Night Circuit', stage: 'The Grove' },
  { time: '23:50', artist: 'Low Tide Club', stage: 'Warehouse' },
] as const;

function SampleSetRow({ time, artist, stage, large }: { time: string; artist: string; stage: string; large?: boolean }) {
  return (
    <li className="flex items-stretch gap-4">
      <span aria-hidden="true" className="w-1 shrink-0 rounded-full bg-[var(--stage-purple-accessible)]" />
      <span
        className={cn(
          'font-display font-bold tabular-nums text-text-secondary',
          large ? 'text-[length:var(--font-size-24)]' : 'text-[length:var(--font-size-18)]',
        )}
      >
        {time}
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            'truncate font-display font-bold text-text-primary',
            large ? 'text-[length:var(--font-size-24)]' : 'text-[length:var(--font-size-18)]',
          )}
        >
          {artist}
        </span>
        <span className="text-[length:var(--font-size-14)] text-text-secondary">{stage}</span>
      </span>
    </li>
  );
}

interface AuthLayoutProps {
  subtitle?: string;
  /** Show one sample set row above the form on phones (the desktop panel always shows the full lineup). */
  phoneSample?: boolean;
  children: ReactNode;
}

/**
 * Auth screen frame. At lg and up: a Stagelight panel with a sample lineup beside a left-aligned
 * form. On phones: one left-aligned column, with an optional sample set row above the form.
 */
export default function AuthLayout({ subtitle, phoneSample, children }: AuthLayoutProps) {
  return (
    <div className="relative z-[1] w-full max-w-[360px] text-left lg:grid lg:max-w-[1040px] lg:grid-cols-2 lg:items-center lg:gap-16">
      <aside
        aria-hidden="true"
        data-testid="auth-lineup-panel"
        className="hidden rounded-2xl border border-glass-border bg-bg-card p-10 lg:block"
      >
        <p className="mb-6 text-[length:var(--font-size-12)] font-medium uppercase tracking-wide text-text-muted">
          Sample lineup
        </p>
        <ul className="flex flex-col gap-8">
          {SAMPLE_SETS.map((set) => (
            <SampleSetRow key={set.artist} {...set} large />
          ))}
        </ul>
      </aside>
      <div className="flex flex-col items-center lg:items-start">
        <AuthBrand subtitle={subtitle} />
        {phoneSample && (
          <ul
            aria-hidden="true"
            data-testid="auth-sample-row"
            className="mb-6 w-full max-w-[360px] rounded-lg border border-border-light bg-bg-card p-3 lg:hidden"
          >
            <SampleSetRow {...SAMPLE_SETS[0]} />
          </ul>
        )}
        {children}
      </div>
    </div>
  );
}
