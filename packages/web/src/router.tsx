import { RootRoute, Route, Router, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { Suspense, type ComponentType, type ReactElement } from 'react';
import AppShell from './components/layout/AppShell';
import RouteErrorBoundary from './components/layout/RouteErrorBoundary';
import { authReady, isAuthenticated, isAdmin } from './routes/auth-guard';
import NotFoundPage from './routes/not-found';
import CardsSkeleton from './components/ui/skeletons/CardsSkeleton';
import TimelineSkeleton from './components/ui/skeletons/TimelineSkeleton';
import GridSkeleton from './components/ui/skeletons/GridSkeleton';
import FestivalModeSkeleton from './components/ui/skeletons/FestivalModeSkeleton';
import PicksSkeleton from './components/ui/skeletons/PicksSkeleton';
import CrewSkeleton from './components/ui/skeletons/CrewSkeleton';
import CrewPlanSkeleton from './components/ui/skeletons/CrewPlanSkeleton';
import AccountSkeleton from './components/ui/skeletons/AccountSkeleton';
import WrapSkeleton from './components/ui/skeletons/WrapSkeleton';
import { parseCrewTab, type CrewTabKey } from '@festie/shared/utils';

// Wrap a lazy component so React.Suspense shows a layout-matched skeleton
// while the chunk downloads — this replaces the previous single "Loading..."
// text fallback and eliminates the visible layout jolt when content arrives.
function withSkeleton(LazyCmp: ComponentType, Skeleton: ComponentType): () => ReactElement {
  return function SuspendedRoute() {
    return (
      <Suspense fallback={<Skeleton />}>
        <LazyCmp />
      </Suspense>
    );
  };
}

// Lazy load route components — import promises are cached, so exposing the
// import factories as named loaders lets us prefetch a chunk before the user
// taps its nav button. AppShell calls these on idle after first paint so
// /grid + /timeline etc. are ready the moment the user switches tabs — no
// more "tab switch → wait for chunk → scroll feels laggy" pattern.
const loadCards = () => import('./routes/cards');
const loadTimeline = () => import('./routes/timeline');
const loadPicks = () => import('./routes/picks');
const loadCrew = () => import('./routes/crew');
const loadCrewPlan = () => import('./routes/crew-plan');
const loadGrid = () => import('./routes/grid');
const loadFestivalMode = () => import('./routes/festival-mode');
const loadWrap = () => import('./routes/wrap');
const loadAdmin = () => import('./routes/admin');
const loadLogin = () => import('./routes/login');
const loadRegister = () => import('./routes/register');
const loadForgot = () => import('./routes/forgot-password');
const loadAccount = () => import('./routes/account');
const loadCompare = () => import('./routes/compare');
const loadSet = () => import('./routes/set');
const loadMap = () => import('./routes/map');

// Generic minimal fallback for auth/admin routes — these chunks are tiny and
// a layout-matched skeleton isn't worth the bytes. Main-tab routes below get
// dedicated skeletons keyed to their real layout.
const MinimalFallback = () => (
  <div
    className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[var(--space-8)] px-6 py-4"
    aria-busy="true"
    aria-label="Loading"
  >
    <div className="skeleton-shimmer h-[200px] m-6 rounded-xl" />
  </div>
);

// Prefetched routes keep their lazyRouteComponent handle so prefetchMainRoutes can
// preload() them: a preloaded route renders without suspending, where React.lazy
// suspended once even with the chunk cached and hit the 300ms fallback throttle.
const cardsLazy = lazyRouteComponent(loadCards);
const timelineLazy = lazyRouteComponent(loadTimeline);
const picksLazy = lazyRouteComponent(loadPicks);
const crewLazy = lazyRouteComponent(loadCrew);
const gridLazy = lazyRouteComponent(loadGrid);
const festivalModeLazy = lazyRouteComponent(loadFestivalMode);
const wrapLazy = lazyRouteComponent(loadWrap);
const accountLazy = lazyRouteComponent(loadAccount);

const CardsView = withSkeleton(cardsLazy, CardsSkeleton);
const TimelineView = withSkeleton(timelineLazy, TimelineSkeleton);
const PicksView = withSkeleton(picksLazy, PicksSkeleton);
const CrewView = withSkeleton(crewLazy, CrewSkeleton);
const CrewPlanView = withSkeleton(lazyRouteComponent(loadCrewPlan), CrewPlanSkeleton);
const GridView = withSkeleton(gridLazy, GridSkeleton);
const FestivalModeView = withSkeleton(festivalModeLazy, FestivalModeSkeleton);
const WrapView = withSkeleton(wrapLazy, WrapSkeleton);
const AccountPage = withSkeleton(accountLazy, AccountSkeleton);
const CompareView = withSkeleton(lazyRouteComponent(loadCompare), MinimalFallback);
const SetDeepLinkView = withSkeleton(lazyRouteComponent(loadSet), CardsSkeleton);
const MapView = withSkeleton(lazyRouteComponent(loadMap), MinimalFallback);
const AdminPanel = withSkeleton(lazyRouteComponent(loadAdmin), MinimalFallback);
const LoginPage = withSkeleton(lazyRouteComponent(loadLogin), MinimalFallback);
const RegisterPage = withSkeleton(lazyRouteComponent(loadRegister), MinimalFallback);
const ForgotPasswordPage = withSkeleton(lazyRouteComponent(loadForgot), MinimalFallback);

/**
 * Prefetch all authenticated main-tab chunks. Called from AppShell on idle
 * after first paint. Each import() is cached by the bundler — calling it
 * again later is a no-op. Keeps the initial bundle small while eliminating
 * the chunk-load pause on tab switch.
 */
export function prefetchMainRoutes() {
  const routes = [cardsLazy, timelineLazy, gridLazy, festivalModeLazy, picksLazy, crewLazy, accountLazy, wrapLazy];
  const run = () => routes.forEach((r) => r.preload?.()?.catch(() => {}));
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 500);
  }
}

// Root route with AppShell layout
const rootRoute = new RootRoute({
  component: AppShell,
});

// ── Public routes (guests can browse the schedule) ──────────────────
const indexRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/',
  component: CardsView,
});

const cardsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/cards',
  component: CardsView,
});

const timelineRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/timeline',
  component: TimelineView,
});

const picksRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/picks',
  component: PicksView,
  // No guest guard: /picks renders <GuestTeaser mode="picks"/> in place for
  // unauthenticated visitors (parity with the always-visible nav tabs).
});

const gridRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/grid',
  component: GridView,
});

const festivalModeRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/festival-mode',
  component: FestivalModeView,
});

const wrapRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/wrap',
  component: WrapView,
  beforeLoad: async () => {
    await authReady();
    if (!isAuthenticated()) throw redirect({ to: '/login' });
  },
});

// ── Auth routes ─────────────────────────────────────────────────────
const loginRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const registerRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
});

const forgotPasswordRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
});

// ── Protected routes (redirect to /login if not authenticated) ──────
const crewRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/crew',
  component: CrewView,
  validateSearch: (search: Record<string, unknown>): { sos?: string; tab?: CrewTabKey } => {
    const out: { sos?: string; tab?: CrewTabKey } = {};
    if (typeof search.sos === 'string') out.sos = search.sos;
    const tab = parseCrewTab(search.tab);
    if (tab) out.tab = tab;
    return out;
  },
  // No guest guard: /crew renders <GuestTeaser mode="crew"/> in place for
  // unauthenticated visitors (parity with the always-visible nav tabs).
});

// /map — full-page map. Public: guests see stages and amenities; crew layers
// render inside the route only for a signed-in user with an active crew.
const mapRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/map',
  component: MapView,
});

// /crew-plan — one-screen offline-native "what's my crew's plan" digest.
const crewPlanRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/crew-plan',
  component: CrewPlanView,
  beforeLoad: async () => {
    await authReady();
    if (!isAuthenticated()) throw redirect({ to: '/login' });
  },
});

const accountRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: AccountPage,
  beforeLoad: async () => {
    await authReady();
    if (!isAuthenticated()) throw redirect({ to: '/login' });
  },
});

// /compare — side-by-side schedule compare with your crew.
// Ported from the legacy `renderCrewSchedule` view in public/views/crew.js.
const compareRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/compare',
  component: CompareView,
  beforeLoad: async () => {
    await authReady();
    if (!isAuthenticated()) throw redirect({ to: '/login' });
  },
});

// /me — convenience alias so direct visits / old bookmarks land on the
// account page instead of "Not Found".
const meRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/me',
  beforeLoad: async () => {
    throw redirect({ to: '/account' });
  },
});

// /set/:setId — shareable artist deep link. Resolves the set's festival, opens
// its detail panel, then drops the user on the schedule (see routes/set.tsx).
const setRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/set/$setId',
  component: SetDeepLinkView,
});

const adminRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: AdminPanel,
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search.tab === 'string' ? { tab: search.tab } : {},
  beforeLoad: async () => {
    await authReady();
    if (!isAuthenticated()) throw redirect({ to: '/login' });
    if (!isAdmin()) throw redirect({ to: '/' });
  },
});

// Route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  cardsRoute,
  timelineRoute,
  picksRoute,
  crewRoute,
  crewPlanRoute,
  mapRoute,
  gridRoute,
  festivalModeRoute,
  wrapRoute,
  accountRoute,
  meRoute,
  compareRoute,
  setRoute,
  adminRoute,
]);

// Router instance
export const router = new Router({
  routeTree,
  notFoundMode: 'root',
  defaultNotFoundComponent: NotFoundPage,
  // Per-route Suspense fallbacks above handle the chunk-load skeleton; this
  // default only fires for beforeLoad redirects + route-level pending states.
  defaultPendingComponent: MinimalFallback,
  defaultPendingMs: 200,
  defaultErrorComponent: RouteErrorBoundary,
});

// ── Route-change focus management (WCAG 2.4.3) ─────────────────────
// After each navigation, move focus to #main-content so screen-reader
// users land at the start of the new page instead of staying on the
// link/button they clicked. Uses two rAFs to let lazy-loaded route
// components mount before focusing (mirrors AppShell scroll-reset).
// Seed with the current path so the initial page load (which resolves once at
// startup) doesn't yank focus to #main-content — only genuine in-app
// navigations, where nextPath differs from the seeded path, move focus.
let lastPath = router.state.location.pathname;
router.subscribe('onResolved', () => {
  const nextPath = router.state.location.pathname;
  if (nextPath === lastPath) return;
  lastPath = nextPath;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const main = document.getElementById('main-content');
      if (main) {
        // tabIndex=-1 allows focus without adding to tab order
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true });
      }
    });
  });
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
