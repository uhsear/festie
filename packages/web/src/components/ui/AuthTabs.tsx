import { Link } from '@tanstack/react-router';
import { AUTH_COPY } from '@festie/shared/constants';
import { cn } from '../../lib/utils';

interface AuthTabsProps {
  /** Which auth screen is active — its segment renders as a non-navigating current tab. */
  active: 'login' | 'register';
}

const TABS = [
  { key: 'login', label: AUTH_COPY.signIn, to: '/login' },
  { key: 'register', label: AUTH_COPY.createAccount, to: '/register' },
] as const;

/**
 * Shared auth-method tab strip for the login/register screens, drawn as the same
 * rounded pill segmented control as ScheduleViewSwitcher. The active segment is a
 * current-page button; the inactive one is a router Link so the auth method swaps in one hop.
 */
export default function AuthTabs({ active }: AuthTabsProps) {
  const container = 'flex gap-1 p-1 mb-6 bg-bg-secondary rounded-full w-full max-w-[360px] relative z-[1]';

  const segBase =
    'flex-1 py-2 px-3 min-h-11 rounded-full text-sm font-semibold text-center inline-flex items-center justify-center';

  const activeSeg = cn(
    'bg-accent-aqua text-[var(--text-on-light-accent)] font-bold cursor-default',
    'transition-[background,color,scale] duration-(--duration-med) ease-(--ease-out)',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
  );

  const inactiveSeg = cn(
    'bg-transparent border border-border',
    'text-text-secondary hover:text-text-primary cursor-pointer',
    'transition-[background,color,scale] duration-(--duration-med) ease-(--ease-out)',
    'press-scale',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
  );

  return (
    <nav className={container} aria-label="Authentication method">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            to={tab.to}
            search={true}
            aria-current={isActive ? 'page' : undefined}
            className={cn(segBase, isActive ? activeSeg : inactiveSeg)}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
