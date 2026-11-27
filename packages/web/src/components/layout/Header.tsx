import { Link, useLocation } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { useAuthStore, useUIStore } from '@festie/shared';
import { useInboxStore, selectInboxUnread } from '@festie/shared/stores/inboxStore';
import { APP_SECTIONS, badgeA11yLabel } from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import { INBOX_COPY, inboxBadgeLabel } from '@festie/shared/constants/inboxCopy';
import BrandWordmark from '../brand/BrandWordmark';
import { cn } from '@/lib/utils';
import UserMenu from './UserMenu';
import FestivalModeToggle from '../features/FestivalModeToggle';
import Button from '../ui/Button';
import DaylightToggle from '../features/DaylightToggle';
import { SECTION_HREF, activeSection } from './sections';
import { useLineupHref } from '../../hooks/useLineupHref';
import { useCrewAttention } from '../../hooks/useCrewAttention';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { postInstallEvent } from '../../lib/installAnalytics';

// The button only shows at 768px and wider; count it as shown there.
function trackInstallShown() {
  if (window.matchMedia('(min-width: 768px)').matches) postInstallEvent('shown');
}

export default function Header() {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const crewBadge = useCrewAttention();
  const unread = useInboxStore(selectInboxUnread);
  const unreadLabel = inboxBadgeLabel(unread);

  // Desktop nav tabs: the five shared sections. Guests skip More because the
  // "Sign in" button in the right section already covers it.
  const current = activeSection(location.pathname);
  const lineupHref = useLineupHref();
  const desktopTabs = APP_SECTIONS.filter((section) => user || section.key !== 'more');

  // Connection status — reflects real network state (uiStore.offlineMode, driven by
  // useOffline and API failures), not the realtime socket: HTTP can work while the
  // socket is down. Only shown when signed in and offline.
  const connected = !useUIStore((state) => state.offlineMode);

  // Availability mirrors the captured install prompt so the button hides where
  // it would no-op (Firefox/Safari, or after a successful install).
  const [installAvailable, setInstallAvailable] = useInstallPrompt(trackInstallShown);

  return (
    <header
      className={cn(
        'flex items-center justify-between shrink-0',
        'bg-[var(--color-bg-chrome)] backdrop-saturate-[180%] backdrop-blur-[var(--glass-blur-strong)]',
        'border-b border-border',
        'shadow-[0_1px_0_var(--color-overlay-1),0_4px_16px_var(--color-shade-7)]',
        'z-dropdown',
        /* safe-area + responsive padding */
        '[padding:14px_24px]',
        '[padding-top:max(14px,env(safe-area-inset-top))]',
        '[padding-left:max(24px,env(safe-area-inset-left))]',
        '[padding-right:max(24px,env(safe-area-inset-right))]',
        /* mobile: tighter padding + gap */
        'max-md:![padding:8px_12px] max-md:![padding-top:max(8px,env(safe-area-inset-top))]',
        'max-md:min-h-0 max-md:gap-4',
        /* extra-small phones */
        'max-[480px]:![padding:6px_10px]',
        'max-[380px]:![padding:6px_10px] max-[380px]:!gap-[6px]',
      )}
    >
      {/* Left section: brand (with connection dot) + util strip */}
      <div className={cn('flex items-center gap-3', 'max-md:min-w-0 max-md:overflow-hidden')}>
        <div className={cn('flex flex-col gap-2', 'max-md:gap-0', 'lg:flex-row lg:items-center lg:gap-4')}>
          <div
            className={cn(
              /* dot is anchored to the brand row so it annotates FESTIE at
                 every breakpoint instead of floating between the two util rows */
              'flex items-center gap-2',
              'text-base',
              /* logo link touch target */
              '[&_a]:inline-flex [&_a]:items-center [&_a]:min-h-11 [&_a]:py-1.5',
              /* size steps only; weight is fixed in BrandWordmark */
              'max-md:text-sm max-md:leading-none',
              'max-[380px]:text-[length:var(--font-size-12)]',
            )}
          >
            {user && !connected && (
              <>
                <span
                  className="w-2 h-2 rounded-full shrink-0 bg-accent-amber shadow-[0_0_8px_var(--color-accent-amber)] animate-blink"
                  role="status"
                  aria-label="Disconnected"
                />
                <span className="type-micro text-accent-amber max-[480px]:hidden">Offline</span>
              </>
            )}
            <Link to="/" aria-label="FESTIE home" className="text-[inherit] no-underline">
              <BrandWordmark markSize={24} />
            </Link>
          </div>
          <div
            className={cn(
              'flex gap-4 items-center',
              /* hidden on mobile (<768px) — Install App */
              'max-md:!hidden',
            )}
          >
            {/* Install App button — only rendered when a captured install prompt
                is available; hidden on Firefox/Safari and after install where it
                would silently no-op. */}
            {installAvailable && (
            <Button
              variant="utility"
              type="button"
              aria-label="Install App for Festie"
              data-testid="install-app-btn"
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M12 15V3" />
                </svg>
              }
              onClick={async () => {
                const evt = window.__festieInstallPrompt;
                if (!evt) return;
                try {
                  await evt.prompt();
                  const choice = await evt.userChoice;
                  postInstallEvent(choice.outcome === 'accepted' ? 'accepted' : 'dismissed');
                } catch {
                  /* user dismissed or prompt already consumed */
                }
                window.__festieInstallPrompt = null; // eslint-disable-line require-atomic-updates -- module-level flag, not a real race
                setInstallAvailable(false);
              }}
            >
              {' Install App'}
            </Button>
            )}
          </div>
        </div>

        {/* Primary nav tabs — desktop only (lg+). Tablet and mobile use the
            bottom nav (BottomNav is `max-lg:block`), so the handoff is a clean
            single switch at the lg breakpoint: no double-nav, no gap. */}
        <nav aria-label="Main navigation">
          <div className="hidden lg:flex gap-1 ml-6">
            {desktopTabs.map((tab) => {
              const active = current === tab.key;
              const badged = tab.key === 'crew' && crewBadge.label !== null;
              return (
                <Link
                  key={tab.key}
                  to={tab.key === 'lineup' ? lineupHref : SECTION_HREF[tab.key]}
                  aria-current={active ? 'page' : undefined}
                  aria-label={badged ? badgeA11yLabel(tab.label, crewBadge) : undefined}
                  className={cn(
                    'inline-flex items-center min-h-11 px-4 py-2 no-underline bg-transparent text-text-secondary text-[length:var(--font-size-14)] font-semibold rounded-sm',
                    'transition-colors duration-(--duration-slow) ease-(--ease-standard) tracking-[0.3px]',
                    'hover:text-text-primary',
                    'border border-transparent',
                    active && 'bg-aqua-a12 text-accent-aqua !border-aqua-a2 !rounded-xl',
                  )}
                >
                  {tab.label}
                  {badged &&
                    (crewBadge.label === '' ? (
                      <span aria-hidden="true" className="inline-block ml-1 w-1.5 h-1.5 rounded-full bg-accent-aqua" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="inline-block ml-1 min-w-4 px-1 py-px rounded-full bg-accent-aqua/20 text-accent-aqua text-[length:var(--font-size-10)] font-semibold leading-none text-center"
                      >
                        {crewBadge.label}
                      </span>
                    ))}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Right section: festival mode + admin badge + profile badge */}
      <div
        className={cn(
          'flex items-center gap-5',
          'max-md:!gap-1.5 max-md:shrink-0 max-md:ml-auto',
          'max-[380px]:gap-3',
          /* hide ghost sm buttons on extra-small phones */
          'max-[380px]:[&_.btn-ghost.btn-sm]:hidden',
        )}
      >
        {user && (
          <Link
            to="/inbox"
            aria-label={unread > 0 ? INBOX_COPY.bellLabelUnread(unread) : INBOX_COPY.bellLabel}
            aria-current={location.pathname === '/inbox' ? 'page' : undefined}
            className={cn(
              'inline-flex items-center justify-center relative min-h-11 min-w-11 rounded-xl text-text-secondary hover:text-text-primary',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
            )}
          >
            <Bell size={20} aria-hidden="true" />
            {unreadLabel && (
              <span
                aria-hidden="true"
                // 12px on a solid disc with a ring: a 10px tinted count on the bell was unreadable and clipped against the icon.
                className="absolute top-0 right-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-aqua px-1 text-[length:var(--font-size-12)] font-bold leading-none text-[var(--text-on-light-accent)] ring-2 ring-[var(--color-bg-primary)]"
              >
                {unreadLabel}
              </span>
            )}
          </Link>
        )}
        <DaylightToggle />

        {/* Festival Mode toggle — flips store flag + navigates to /festival-mode */}
        <FestivalModeToggle />

        {/* User menu / profile badge — guests get an explicit Sign in entry
            instead (desktop hides BottomNav's Account path). */}
        {user ? (
          <UserMenu user={user} />
        ) : (
          <Link
            to="/login"
            search={{ next: location.pathname === '/p' ? '/p' : location.href }}
            className={cn(
              'inline-flex items-center justify-center min-h-11 min-w-11 px-4 rounded-xl no-underline whitespace-nowrap',
              'text-accent-aqua text-[length:var(--font-size-14)] font-semibold tracking-[0.3px]',
              'border border-accent-aqua/40 transition-colors duration-(--duration-med)',
              'hover:bg-aqua-a12 hover:border-accent-aqua/70',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
            )}
          >
            {COPY.auth.signIn}
          </Link>
        )}
      </div>
    </header>
  );
}
