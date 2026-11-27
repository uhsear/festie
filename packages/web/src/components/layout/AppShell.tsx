import { useEffect, Suspense, lazy } from 'react';
import { Outlet, useLocation } from '@tanstack/react-router';
import { Loader } from 'lucide-react';
import { useAuthStore, useFestivalModeStore } from '@festie/shared';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useOffline } from '@festie/shared/hooks';
import Header from './Header';
import BottomNav from './BottomNav';
import SubHeader from './SubHeader';
import { isSchedulePath } from './ScheduleViewSwitcher';
import PageTransition from './PageTransition';
import RouteAnnouncer from './RouteAnnouncer';
import GuestFooter from './GuestFooter';
import OfflineBanner from '../features/OfflineBanner';
import UpdatePrompt from '../features/UpdatePrompt';
import IOSInstallDrawer from '../features/IOSInstallDrawer';
import NowNextStrip from '../features/NowNextStrip';
import FestivalDayBanner from '../features/FestivalDayBanner';
import SosBanner from '../features/SosBanner';
import SosDock from './SosDock';
import AnnouncementBanner from '../features/AnnouncementBanner';
import LiveLocationSharing from '../crew/LiveLocationSharing';
import Onboarding from '../features/Onboarding';
import JoinCrewSheet from '../crew/JoinCrewSheet';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useIOSInstall } from '../../hooks/useIOSInstall';
import { useInboxRefresh } from '../../hooks/useInboxRefresh';
import { useScrollReset } from '../../hooks/useScrollReset';
import { OfflineQueueContext, useOfflineQueueBridge } from '../../hooks/useOfflineQueueBridge';
import { useFestivalLoader } from '../../hooks/useFestivalLoader';
import { useFestivalMode } from '../../hooks/useFestivalMode';
import { prefetchMainRoutes } from '../../router';
import ArtistSheetHost from '../features/ArtistSheetHost';
import { cn } from '../../lib/utils';
import { SocketContext } from '../../lib/socketContext';
import { useThemeSync } from '../../lib/theme';

const authRoutes = ['/login', '/register', '/signup/finish', '/forgot-password', '/reset-password', '/verify-email'];

// The set sheet only mounts once a set is picked, so it stays out of the entry chunk and
// loads on idle (below) before the first tap.
const loadDetailPanel = () => import('../features/DetailPanel');
const DetailPanel = lazy(loadDetailPanel);

// Centered branded loader for lazy-route chunk loads. Replaces the bare
// "Loading..." text the Suspense boundaries used to fall back to.
function RouteFallback() {
  return (
    <div
      className="flex flex-1 items-center justify-center w-full min-h-[40vh] py-10"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader className="w-8 h-8 animate-spin text-accent-aqua motion-reduce:animate-none" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

// Routes where the global festival/day/stage sub-header has no purpose.
// The first-visit walkthrough shows on the lineup only, never over a deep link (/set/:id, /join, /u/:username).
const onboardingRoutes = ['/', '/cards'];
const noSubHeaderRoutes = ['/account', '/crew'];

// Routes that keep ONLY the day toggle (Sat/Sun).
// /picks has its own filters (T20); /grid gets the full schedule filters (T17).
const dayOnlySubHeaderRoutes = ['/compare'];

// Routes that keep ONLY the festival selector.
// Every screen scoped to one festival carries the picker, so the festival it shows is never a guess.
const festivalOnlySubHeaderRoutes = ['/wrap', '/picks', '/map', '/caught', '/rate', '/crew-plan'];

// Routes whose content fills the shell (grid, timeline, map); a footer would shrink them.
const FILL_SHELL_PATHS = ['/grid', '/timeline', '/map'];

export default function AppShell() {
  const location = useLocation();
  // Runs on every route, including sign-in pages that render no Header, so a first visit follows the OS theme.
  useThemeSync();
  const isGuest = useAuthStore((s) => !s.user);
  const detailSet = useUIStore((s) => s.detailSet);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const detailAutoSpotify = useUIStore((s) => s.detailAutoSpotify);
  const setDetailAutoSpotify = useUIStore((s) => s.setDetailAutoSpotify);

  const isAuthRoute = authRoutes.includes(location.pathname);
  const hideSubHeader = noSubHeaderRoutes.includes(location.pathname);
  const dayOnlySubHeader = dayOnlySubHeaderRoutes.includes(location.pathname);
  const festivalOnlySubHeader = festivalOnlySubHeaderRoutes.includes(location.pathname);

  // Mirror low-power mode on <html> so CSS can stop the ambient animation loops.
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-low-power', lowPowerMode);
  }, [lowPowerMode]);

  // Mirror tab visibility so CSS can pause the ambient loops while the tab is hidden.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.toggleAttribute('data-tab-hidden', document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  // --- Side-effect hooks ---
  useScrollReset(location.pathname);
  // useRealtimeSync owns the single shared socket; expose it via context so the
  // crew Live Location publisher can emit on it (no second connection). The
  // optional chaining tolerates the test mock that returns undefined.
  const realtime = useRealtimeSync() as ReturnType<typeof useRealtimeSync> | undefined;
  const socket = realtime?.socket ?? null;
  useOffline();
  usePushNotifications();
  // Gated to a return visit (second session), 10s + 1 interaction, and a 30-day cooldown.
  const iosInstall = useIOSInstall();
  useInboxRefresh();
  const offlineQueue = useOfflineQueueBridge();
  const { pendingJoinCode, clearPendingJoin } = useFestivalLoader();
  const { showDayBanner } = useFestivalMode(location.pathname);

  // A ?joinCrew= link stages its code instead of enrolling the visitor outright;
  // this sheet is the consent step that completes it. Rendered in BOTH the auth-route
  // and main branches below because a guest's code is staged right after sign-up
  // while the user may still be on /register -- a sheet that never paints
  // there would leave the invite link silently doing nothing.
  const joinCrewSheet = <JoinCrewSheet code={pendingJoinCode} onClose={clearPendingJoin} />;

  // Prefetch main-tab chunks on idle so switching between tabs is instant.
  useEffect(() => {
    prefetchMainRoutes();
    const warmDetailPanel = () => void loadDetailPanel().catch(() => {});
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(warmDetailPanel, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(warmDetailPanel, 1000);
    return () => clearTimeout(id);
  }, []);

  // Auth routes don't use app shell layout
  if (isAuthRoute) {
    return (
      <main
        className={cn(
          'auth-screen',
          /* min-h-dvh (not min-h-full): the parent chain has no explicit height,
             so min-h-full collapses to content height and justify-center becomes
             a no-op — dvh sizes against the viewport directly. */
          'flex flex-col items-center min-h-dvh overflow-y-auto text-center',
          'px-5 relative',
          '[padding-top:max(2.5rem,env(safe-area-inset-top,0px))]',
          'pb-10',
          /* On tall desktop viewports the card left ~55% dead space below when
             top-pinned; center it there while keeping the top-pinned safe-area
             behavior on short/mobile heights. */
          'lg:[@media(min-height:720px)]:justify-center',
        )}
        aria-label="Authentication"
      >
        <RouteAnnouncer />
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
        {isGuest && <GuestFooter />}
        {joinCrewSheet}
      </main>
    );
  }

  return (
    <SocketContext.Provider value={socket}>
      <OfflineQueueContext.Provider value={offlineQueue}>
      <div id="app">
        {/* Skip link -- WCAG 2.4.1 Bypass Blocks */}
        <a
          href="#main-content"
          className={cn(
            'skip-link',
            'absolute left-[-9999px] top-0 z-[var(--z-top)]',
            'bg-bg-primary text-accent-aqua px-4 py-2 underline font-semibold',
            'focus:left-[var(--space-4)] focus:top-[var(--space-4)]',
          )}
          onClick={() => {
            const main = document.getElementById('main-content');
            if (main) {
              main.setAttribute('tabindex', '-1');
              main.focus({ preventScroll: false });
            }
          }}
        >
          Skip to main content
        </a>

        <RouteAnnouncer />
        <UpdatePrompt />
        <IOSInstallDrawer open={iosInstall.shouldShow} onClose={iosInstall.dismiss} />
        {onboardingRoutes.includes(location.pathname) && <Onboarding suspended={!!pendingJoinCode} />}
        {joinCrewSheet}
        <Header />
        <OfflineBanner />
        <SosBanner />
        <AnnouncementBanner />
        <LiveLocationSharing />

        {showDayBanner && <FestivalDayBanner />}

        <div className="main-content flex flex-1 overflow-hidden flex-col">
          {!hideSubHeader && <SubHeader dayOnly={dayOnlySubHeader} festivalOnly={festivalOnlySubHeader} />}
          {/* The grid has its own now line and Jump to now, and cannot spare the height. */}
          {isSchedulePath(location.pathname) && location.pathname !== '/grid' && <NowNextStrip />}

          <main
            id="main-content"
            className={cn(
              'content-area',
              'flex-1 overflow-auto px-6 py-4',
              '[-webkit-overflow-scrolling:touch] [overscroll-behavior-y:contain]',
            )}
          >
            <Suspense fallback={<RouteFallback />}>
              <PageTransition>
                <Outlet />
                {/* Inside the wrapper so it flows after content taller than the viewport. */}
                {isGuest && !FILL_SHELL_PATHS.includes(location.pathname) && <GuestFooter />}
              </PageTransition>
            </Suspense>
          </main>
        </div>

        <BottomNav />
        <SosDock />
        <ArtistSheetHost />

        {detailSet && (
          <Suspense fallback={null}>
            <DetailPanel
              key={detailSet.id}
              set={detailSet}
              autoOpenSpotify={detailAutoSpotify}
              onClose={() => {
                setDetailSet(null);
                setDetailAutoSpotify(false);
              }}
            />
          </Suspense>
        )}
      </div>
      </OfflineQueueContext.Provider>
    </SocketContext.Provider>
  );
}
