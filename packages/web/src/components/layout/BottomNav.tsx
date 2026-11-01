import React, { useMemo, useEffect, useRef } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { useFestivalStore } from '@festie/shared/stores';
import { isFestivalOver } from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import { CONCEPT_ICON } from '../../lib/conceptIcons';
import { cn } from '../../lib/utils';

interface NavTab {
  label: string;
  href: string;
  icon: React.ReactNode;
  /** Trigger to warm this tab's lazy chunk before the user taps. */
  prefetch?: () => Promise<unknown>;
}

// Per-tab chunk prefetchers. Called from onPointerDown so the tap-up navigation
// happens with the chunk already loaded — no chunk-load pause that made the
// first scroll after tab switch feel laggy.
const prefetchers: Record<string, () => Promise<unknown>> = {
  '/cards': () => import('../../routes/cards'),
  '/grid': () => import('../../routes/grid'),
  '/picks': () => import('../../routes/picks'),
  '/crew': () => import('../../routes/crew'),
  '/wrap': () => import('../../routes/wrap'),
  '/account': () => import('../../routes/account'),
};

/** Schedule icon — matches legacy createSvgIcon('cards') */
const ScheduleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

/** Crew icon — people */
const CrewIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

/** Profile icon — user silhouette. Mobile needs a direct entry to /account
   because the header profile badge can get clipped off-screen at 390 px when
   the util-strip (Install App + Support Me) hogs .header-left width. */
const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

// Schedule/Timeline/Grid were three separate tabs; they now collapse into one
// "Schedule" destination with an in-page ScheduleViewSwitcher (parity with the
// mobile SegmentedControl). This drops the nav from up-to-7 to ~5 tabs.
const baseTabs: NavTab[] = [{ label: 'Schedule', href: '/cards', icon: <ScheduleIcon /> }];

// The single Schedule tab reads as active across all three schedule views.
const SCHEDULE_HREFS = ['/', '/cards', '/timeline', '/grid'];

const authTabs: NavTab[] = [
  { label: COPY.picks.tab, href: '/picks', icon: <CONCEPT_ICON.picks aria-hidden="true" /> },
  { label: 'Crew', href: '/crew', icon: <CrewIcon /> },
  { label: 'Account', href: '/account', icon: <ProfileIcon /> },
];

const wrapTab: NavTab = { label: COPY.wrap.tab, href: '/wrap', icon: <CONCEPT_ICON.wrap aria-hidden="true" /> };

export default function BottomNav() {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const days = useFestivalStore((state) => state.days);
  const footerRef = useRef<HTMLElement>(null);

  // Drive --bottom-nav-h on :root so floating elements (e.g. the Timeline "Now"
  // FAB) can position themselves above the nav without hard-coding 88px. The
  // ResizeObserver fires whenever the nav height changes (safe-area insets shift
  // on orientation change, font-size zoom, etc.). Set to 0 on desktop where
  // BottomNav is hidden (lg+) so FABs fall back to their own lg: overrides.
  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.borderBoxSize?.[0]?.blockSize ?? entries[0]?.contentRect?.height ?? 0;
      document.documentElement.style.setProperty('--bottom-nav-h', `${h}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--bottom-nav-h');
    };
  }, []);

  // All tabs stay visible for guests (parity with mobile's NativeTabs): Picks/
  // Crew advertise the features and gate in-place via GuestTeaser, Account is
  // the sign-in entry (routes a guest to /login). Show Wrap tab ONLY after the
  // festival has ended — otherwise it's noise. Empty-state inside /wrap handles
  // the "coming soon" case for a direct URL visit before then.
  const tabs = useMemo(() => {
    const wrapUnlocked = isFestivalOver(currentFestival, days);
    return wrapUnlocked ? [...baseTabs, ...authTabs, wrapTab] : [...baseTabs, ...authTabs];
  }, [currentFestival, days]);

  const isActive = (href: string) => {
    if (href === '/cards') return SCHEDULE_HREFS.includes(location.pathname);
    return location.pathname === href;
  };

  return (
    <footer
      ref={footerRef}
      className={cn(
        // Shown on mobile AND tablet (<lg). Desktop (lg+) uses the header tabs
        // instead. Clean single handoff at lg — see Header's nav comment.
        'hidden max-lg:block flex-shrink-0',
        'bg-[var(--color-bg-chrome)] backdrop-saturate-[180%] backdrop-blur-[var(--glass-blur-strong)]',
        'border-t border-border',
        '[padding:6px_0_max(8px,env(safe-area-inset-bottom))]',
        '[padding-left:env(safe-area-inset-left)]',
        '[padding-right:env(safe-area-inset-right)]',
        'shadow-[0_-1px_0_var(--color-overlay-1),0_-4px_16px_var(--color-shade-6)]',
        'print:hidden',
      )}
      data-bottom-nav
    >
      <nav className="flex justify-around w-full max-md:gap-0.5" aria-label="Primary">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              to={tab.href}
              aria-current={active ? 'page' : undefined}
              aria-label={`View ${tab.href === '/account' && !user ? COPY.auth.signIn : tab.label}`}
              className={cn(
                'flex flex-col items-center gap-1 px-3 py-2',
                'bg-transparent text-text-muted text-[10px] font-semibold no-underline',
                'rounded-sm min-h-11 min-w-0 flex-1 overflow-hidden',
                'transition-[color,transform] duration-150 ease-[ease]',
                'active:scale-90 motion-reduce:active:!transform-none',
                '[&_svg]:w-[22px] [&_svg]:h-[22px]',
                'max-[480px]:px-[2px] max-[480px]:py-1.5 max-[480px]:text-[10px] max-[480px]:gap-1',
                'max-[480px]:[&_svg]:w-5 max-[480px]:[&_svg]:h-5',
                'max-[375px]:min-h-11 max-[375px]:px-1 max-[375px]:py-[5px]',
                'max-[359px]:justify-center max-[359px]:px-0 max-[359px]:py-1.5',
                active && ['text-accent-aqua', '[&_svg]:drop-shadow-[0_0_6px_rgba(0,232,208,0.4)]'],
              )}
              onPointerEnter={() => prefetchers[tab.href]?.().catch(() => {})}
              onPointerDown={() => prefetchers[tab.href]?.().catch(() => {})}
            >
              {tab.icon}
              <span className={cn('max-w-full overflow-hidden text-ellipsis whitespace-nowrap', 'max-[359px]:hidden')}>
                {tab.href === '/account' && !user ? COPY.auth.signIn : tab.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </footer>
  );
}
