import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { Map as MapIcon } from 'lucide-react';
import { useAuthStore } from '@festie/shared';
import { APP_SECTIONS, type AppSectionKey } from '@festie/shared/utils';
import { cn } from '../../lib/utils';
import { SECTION_HREF, activeSection } from './sections';

// Per-tab chunk prefetchers. Called from onPointerDown so the tap-up navigation
// happens with the chunk already loaded — no chunk-load pause that made the
// first scroll after tab switch feel laggy.
const prefetchers: Record<string, () => Promise<unknown>> = {
  '/cards': () => import('../../routes/cards'),
  '/timeline': () => import('../../routes/timeline'),
  '/grid': () => import('../../routes/grid'),
  '/picks': () => import('../../routes/picks'),
  '/crew': () => import('../../routes/crew'),
  '/map': () => import('../../routes/map'),
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

/** Picks icon — star */
const PicksIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
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

const SECTION_ICON: Record<AppSectionKey, React.ReactNode> = {
  lineup: <ScheduleIcon />,
  myPlan: <PicksIcon />,
  crew: <CrewIcon />,
  map: <MapIcon aria-hidden="true" />,
  more: <ProfileIcon />,
};

export default function BottomNav() {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
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

  // All five sections stay visible for guests (parity with mobile's NativeTabs):
  // My Plan/Crew gate in-place via GuestTeaser, and the More slot reads "Sign in"
  // because /account routes a guest to /login.
  const current = activeSection(location.pathname);

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
        {APP_SECTIONS.map((section) => {
          const href = SECTION_HREF[section.key];
          const label = section.key === 'more' && !user ? 'Sign in' : section.label;
          const active = current === section.key;
          return (
            <Link
              key={section.key}
              to={href}
              aria-current={active ? 'page' : undefined}
              aria-label={`View ${label}`}
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
              onPointerEnter={() => prefetchers[href]?.().catch(() => {})}
              onPointerDown={() => prefetchers[href]?.().catch(() => {})}
            >
              {SECTION_ICON[section.key]}
              <span className={cn('max-w-full overflow-hidden text-ellipsis whitespace-nowrap', 'max-[359px]:hidden')}>
                {label}
              </span>
            </Link>
          );
        })}
      </nav>
    </footer>
  );
}
