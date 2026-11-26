// MUST be first: configures AsyncStorage before any store module is imported
// (and thus before zustand-persist hydrates). See bootstrap.ts.
import '../bootstrap';
import { useEffect, useRef, useState } from 'react';
import { AppState, View, ActivityIndicator, StyleSheet, Appearance, useColorScheme } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments, usePathname, type Href, useRootNavigationState, router as globalRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { configureApi, setAuthToken, drainQueue, refreshPendingCount } from '@festie/shared/services';
import { decideFlap } from '../lib/connectivityHysteresis';
import { API_ORIGIN } from '../lib/apiOrigin';
import { useAuthStore, useUIStore } from '@festie/shared/stores';
import { COPY } from '@festie/shared/constants';
import { scrubSensitiveUrl } from '@festie/shared/utils';
import { colors as stageColors, colorsDaylight, fontSize } from '@festie/shared/tokens';
import { useFonts } from 'expo-font';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UIProvider } from '../contexts/UIContext';
import OfflineBanner from '../components/OfflineBanner';
import Toaster from '../components/Toaster';
import SosBanner from '../components/SosBanner';
import LiveSharePublisher from '../components/LiveSharePublisher';
import AnnouncementBanner from '../components/AnnouncementBanner';
import FirstRunIntro from '../components/FirstRunIntro';
import { shouldSkipIntro } from '../lib/pendingInvite';
import ErrorBoundary from '../components/ErrorBoundary';
import HeaderTitle from '../components/HeaderTitle';
import { TopBannerContext } from '../components/ScreenHeader';
import { snoozeReminder, useLocalReminders } from '../hooks/useLocalReminders';
import { useOngoingNotification } from '../hooks/useOngoingNotification';
import { useOtaUpdatePrompt } from '../hooks/useOtaUpdatePrompt';
import { ensureAndroidChannels, unregisterPushOnSignOut, usePushTokenRotation } from '../hooks/useMobilePush';
import { useTokens } from '../hooks/useTokens';
import { onHydrated } from '../lib/hydrationGate';
import { isGuestBlocked } from '../lib/authRoutes';
import { setReturnTo, takeReturnTo } from '../lib/returnTo';
import { routeNotification } from '../lib/routeNotification';
import ArtistSheetHost from '../components/ArtistSheetHost';

// Hold the native splash until fonts + hydration complete (NOT the session
// check — that reconciles behind an interactive UI; see `loading` below).
// hideAsync is called when `loading` flips false inside AuthGate; the existing
// 4-second bootTimedOut ceiling is the forced-hide backstop so the app never
// wedges. preventAutoHideAsync must run at module scope (before any render).
SplashScreen.preventAutoHideAsync().catch(() => {});

// Set the root view background so Android gesture-nav's system navigation bar
// inherits the app background instead of defaulting to white (which flashes
// behind the bottom edge on edge-to-edge Android 10+ devices). This module-scope
// call paints the stage default before first render; AuthGate re-applies it
// whenever the persisted/toggled theme changes.
SystemUI.setBackgroundColorAsync(stageColors.bg.primary).catch(() => {});

// First-run intro flag — mirrors the web key for parity.
const INTRO_KEY = 'festie_onboarding_completed';

// @sentry/react-native is a third-party NATIVE module not present in the Expo
// Go runtime — calling init()/wrap() there warns and degrades. Detect Expo Go
// and skip Sentry so the app runs cleanly in Expo Go for quick UI iteration.
// (Full crash reporting still works in dev/preview/production builds.)
const isExpoGo = Constants.appOwnership === 'expo';

// Crash/error monitoring — mirrors the web's env-gated Sentry init. No-op
// until EXPO_PUBLIC_SENTRY_DSN is set (so it ships inert without a DSN). The
// @sentry/react-native Expo plugin IS configured in app.json (org festi-jn /
// project festie); release source maps upload during the EAS build via the
// SENTRY_AUTH_TOKEN env secret + scripts/install-sentry-cli.cjs (which provides
// the @sentry/cli binary that pnpm v10's build-script gating otherwise skips).
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN && !isExpoGo) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_RATE ?? 0.05),
    environment: Updates.channel || (__DEV__ ? 'development' : 'production'),
    sendDefaultPii: false,
    // Reset links carry ?token=: keep tokens and invite codes out of Sentry.
    beforeSend(event) {
      if (event.request) event.request.url = scrubSensitiveUrl(event.request.url);
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      const d = breadcrumb.data;
      if (d) {
        if (d.url) d.url = scrubSensitiveUrl(d.url);
        if (d.from) d.from = scrubSensitiveUrl(d.from);
        if (d.to) d.to = scrubSensitiveUrl(d.to);
      }
      return breadcrumb;
    },
  });
}

// Wire up 401 handling: attempt a token refresh, then logout on failure.
configureApi({
  baseUrl: `${API_ORIGIN}/api/v1`,
  authMode: 'bearer',
  onUnauthorized: async () => {
    // GUEST GUARD: with no session there is nothing to refresh and nothing to
    // log out. Without this, any guest request that hits an authenticated
    // endpoint (e.g. an eagerly-mounted account section) 401s, the refresh
    // 401s too, and logout() -> resetAllStores() wipes the guest's festival
    // selection — the "festival opens then closes" bug.
    if (!useAuthStore.getState().userToken) {
      return false;
    }
    try {
      await useAuthStore.getState().refreshToken();
      return true;
    } catch {
      await useAuthStore.getState().logout();
      // AFTER logout: with a dead session the token DELETE would 401 and re-enter
      // this handler. The guest guard above returns false once userToken is null.
      await unregisterPushOnSignOut();
      useUIStore.getState().showToast(COPY.session.signedOut);
      return false;
    }
  },
});

/**
 * Owns connectivity and queue-drain wiring for the whole app (NetInfo ->
 * uiStore.offlineMode, drain on reconnect, foreground and bounded retry), so
 * the drain does not depend on the OfflineBanner UI being mounted.
 */
function useQueueDrain(enabled: boolean) {
  const offlineMode = useUIStore((s) => s.offlineMode);
  const setOfflineMode = useUIStore((s) => s.setOfflineMode);
  const pendingSync = useUIStore((s) => s.pendingSync);

  // Bounded retry timer for a drain that leaves items queued while we're
  // still online (e.g. a transient 5xx) — the only other drain triggers are
  // NetInfo transitions and AppState foreground, neither of which fires again
  // on their own if the device never goes offline in between.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(15_000); // 15s, doubling to a 60s cap

  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    backoffRef.current = 15_000;
  };

  const scheduleRetry = () => {
    if (retryTimerRef.current) return; // already scheduled
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      runDrain();
    }, backoffRef.current);
    backoffRef.current = Math.min(backoffRef.current * 2, 60_000);
  };

  // Single entry point for every drain trigger (NetInfo, AppState, retry
  // timer) so drain logic itself stays in the shared queue module.
  const runDrain = () => {
    drainQueue()
      .catch((e) => Sentry.captureException(e))
      .finally(() => {
        const { offlineMode: stillOffline, pendingSync: stillPending } = useUIStore.getState();
        if (!stillOffline && stillPending > 0) scheduleRetry();
        else clearRetryTimer();
      });
  };

  // Connectivity hysteresis: a reported transition must hold before it reaches
  // the store, because OfflineMap tears its WebView down on offlineMode (see
  // lib/connectivityHysteresis.ts for the delays and why they differ).
  const flipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the most recent NetInfo event reported. An armed offline flip is a
  // FLOOR that no later event restarts, so it can outlive the condition that
  // armed it; this is what the timer re-checks before committing.
  const lastReportedOnlineRef = useRef<boolean | null>(null);
  const pendingOnlineRef = useRef<boolean | null>(null);
  const firstNetEventRef = useRef(true);

  const cancelFlip = () => {
    if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
    flipTimerRef.current = null;
    pendingOnlineRef.current = null;
  };

  // Drive shared offline state from device connectivity.
  useEffect(() => {
    if (!enabled) return;
    refreshPendingCount().catch((e) => Sentry.captureException(e));

    // The drain has to run on the COMMIT, not on the raw event: drainQueue()
    // early-returns while uiStore still reads offline, so draining during the
    // confirm window would be a no-op and the queue would sit until the next
    // NetInfo event or foreground.
    const commit = (online: boolean) => {
      setOfflineMode(!online);
      if (online) runDrain();
    };

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      lastReportedOnlineRef.current = online;
      const firstEvent = firstNetEventRef.current;
      firstNetEventRef.current = false;
      const action = decideFlap({
        online,
        currentOffline: useUIStore.getState().offlineMode,
        pendingOnline: pendingOnlineRef.current,
        firstEvent,
      });
      if (action.type === 'ignore') {
        // Includes the online blip that arrives while an offline flip is armed.
        // The flip deliberately stays armed (see decideFlap), but a queue
        // stranded by a transient 5xx still relies on a duplicate online event
        // to drain, exactly as the 'cancel' path below does.
        if (online) runDrain();
        return;
      }
      cancelFlip();
      if (action.type === 'cancel') {
        // Already where this event says we should be. Still drain: this is the
        // path a duplicate online event took before hysteresis existed, and a
        // queue stranded by a transient 5xx relies on it.
        if (online) runDrain();
        return;
      }
      if (action.type === 'commit') {
        commit(online);
        return;
      }
      pendingOnlineRef.current = online;
      flipTimerRef.current = setTimeout(() => {
        // Cleared BEFORE the write so unmount-during-flush can't leave a live
        // handle, and so the commit sees no pending target.
        flipTimerRef.current = null;
        pendingOnlineRef.current = null;
        // The floor has elapsed, but the radio may have recovered inside it and
        // this flip was deliberately not cancelled. Commit only if the last
        // thing NetInfo said still agrees, so a single handover blip cannot
        // tear the map down 5s after it ended.
        if (lastReportedOnlineRef.current !== null && lastReportedOnlineRef.current !== online) return;
        commit(online);
      }, action.delayMs);
    });
    return () => {
      unsubscribe();
      // Unsubscribing stops new events but not an already-armed flip -- without
      // this, a timer fired after unmount writes stale connectivity into the
      // shared store.
      cancelFlip();
      clearRetryTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runDrain/cancelFlip close over refs only, stable across renders
  }, [setOfflineMode, enabled]);

  // Re-drain on foreground: a transient failure or a dropped background
  // reconnect can otherwise strand "Syncing N…" until the next NetInfo flip.
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !offlineMode && pendingSync > 0) runDrain();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runDrain closes over refs only, stable across renders
  }, [enabled, offlineMode, pendingSync]);
}

function AuthGate() {
  const { colors } = useTokens();
  const theme = useUIStore((s) => s.theme);
  const followSystemTheme = useUIStore((s) => s.followSystemTheme);
  const applySystemScheme = useUIStore((s) => s.applySystemScheme);
  const systemScheme = useColorScheme();
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const checkSession = useAuthStore((s) => s.checkSession);
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  const navState = useRootNavigationState();
  // Initialize from persist's current hydration state. When Zustand persist has
  // already rehydrated synchronously (e.g. noop storage), restore the bearer
  // token into the API client right here in the lazy initializer so we start
  // `hydrated` and avoid a setState-in-effect for that path. The async
  // onFinishHydration path is handled by the effect below.
  const [hydrated, setHydrated] = useState(() => {
    if (useAuthStore.persist.hasHydrated()) {
      const token = useAuthStore.getState().userToken;
      if (token) setAuthToken(token);
      return true;
    }
    return false;
  });
  // The saved theme lives in uiStore's persist. Hiding the splash before it
  // rehydrates paints the Stage palette first on a Daylight cold start.
  const [uiHydrated, setUiHydrated] = useState(() => useUIStore.persist.hasHydrated());
  useEffect(() => onHydrated(useUIStore.persist, () => setUiHydrated(true)), []);
  // null = still reading the flag; false = show intro; true = already seen.
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);

  // Brand typography (Stagelight): Clash Display for display roles, Space
  // Grotesk for body roles. Registered here so typeStyle()'s fontFamily faces exist
  // before any screen renders; the splash overlay below stays up until these
  // load so the app never flashes the system font then reflows into the brand
  // face. Weight-specific cuts mirror the role→weight map in useTokens.ts.
  const [fontsLoaded, fontError] = useFonts({
    'ClashDisplay-Regular': require('../assets/fonts/clash-display/ClashDisplay-Regular.otf'),
    'ClashDisplay-Medium': require('../assets/fonts/clash-display/ClashDisplay-Medium.otf'),
    'ClashDisplay-Semibold': require('../assets/fonts/clash-display/ClashDisplay-Semibold.otf'),
    'ClashDisplay-Bold': require('../assets/fonts/clash-display/ClashDisplay-Bold.otf'),
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  // Boot safety valve. The splash below covers the whole window with
  // pointerEvents="auto" while `loading` is true — so anything that pins
  // `loading` (a useFonts() call that never resolves on a prod/OTA build, or a
  // persist rehydration that never resolves) would leave the app rendered but
  // completely untappable / unscrollable. Force the splash down after a hard
  // ceiling so the UI is ALWAYS reachable; fonts swap in a frame later if/when
  // they arrive. Normal boot resolves in well under this, so users never see
  // the timeout.
  const [bootTimedOut, setBootTimedOut] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setBootTimedOut(true), 4000);
    return () => clearTimeout(id);
  }, []);

  // When the OfflineBanner renders a bar IN FLOW above the navigator, it paints
  // behind the status bar and so already owns the top safe-area inset. Track
  // that so ScreenHeader (via TopBannerContext) drops its own insets.top and
  // doesn't leave a double-applied notch gap below the banner.
  const [bannerActive, setBannerActive] = useState(false);
  // The app-wide SOS banner sits under the OfflineBanner and takes the inset
  // only when the OfflineBanner is not showing.
  const [sosActive, setSosActive] = useState(false);
  // The announcement banner sits under the SOS banner and takes the inset last.
  const [announceActive, setAnnounceActive] = useState(false);

  // Ensure Android notification channels exist BEFORE any notification is
  // scheduled. useLocalReminders targets channelId 'updates' which must exist
  // even if the user never visits the Account screen (where useMobilePush
  // previously created them on first register).
  useEffect(() => {
    ensureAndroidChannels().catch(() => {});
  }, []);

  // Navigate when the user taps a push notification. Without this listener,
  // tapping a notification opens the app but never deep-links to the relevant
  // screen. The data payload from FCM/APNs includes a `deepLink` or `setId`
  // field that maps to an expo-router path.
  const notificationResponseRef = useRef<Notifications.Subscription | null>(null);
  // Identifier of the last notification response we've routed. Shared across the
  // warm listener and the cold-start effect below so a single tap can't route
  // twice (both paths observe the same response for a warm tap).
  const handledResponseRef = useRef<string | null>(null);
  useEffect(() => {
    notificationResponseRef.current = Notifications.addNotificationResponseReceivedListener((response) => {
      handledResponseRef.current = response.notification.request.identifier;
      if (response.actionIdentifier === 'snooze-5') {
        snoozeReminder(response.notification.request.content);
        return;
      }
      routeNotification(router, response.notification.request.content.data);
    });
    return () => {
      notificationResponseRef.current?.remove();
    };
  }, [router]);

  // COLD-START PUSH: a notification tapped while the app was KILLED is delivered
  // as the *launching* response via useLastNotificationResponse — the runtime
  // listener above mounts after launch and never sees it. Route it once the
  // navigator is ready (navState.key + rAF, same gating as the AuthGate redirect
  // effect), guarding against handling the same response twice.
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!navState?.key) return;
    if (!lastNotificationResponse) return;
    const id = lastNotificationResponse.notification.request.identifier;
    if (handledResponseRef.current === id) return;
    const data = lastNotificationResponse.notification.request.content.data;
    const raf = requestAnimationFrame(() => {
      handledResponseRef.current = id;
      if (lastNotificationResponse.actionIdentifier === 'snooze-5') {
        snoozeReminder(lastNotificationResponse.notification.request.content);
        return;
      }
      routeNotification(router, data);
    });
    return () => cancelAnimationFrame(raf);
  }, [lastNotificationResponse, navState?.key, router]);

  // M1: pre-computed on-device set reminders. Reconciles local notifications
  // whenever picks/reminders change (fires even in airplane mode); FCM stays the
  // at-home backstop. Mounted at the root so it tracks the active profile across
  // every screen.
  useLocalReminders();
  usePushTokenRotation();

  // Keep Android's sticky festival status and iOS's Live Activity/widget alive
  // across route changes. The hook cancels them when the profile/festival model
  // becomes inactive, including logout and festival-window expiry.
  // Persisted festival/profile data can render before the saved session has
  // been revalidated. Never publish those personal picks to a notification or
  // Live Activity until auth is known-good for this launch.
  useOngoingNotification(sessionChecked && !!user);

  useEffect(() => {
    AsyncStorage.getItem(INTRO_KEY)
      .then((v) => setIntroSeen(v === 'true'))
      .catch(() => setIntroSeen(true)); // on error, don't block with the intro
  }, []);

  const introReplay = useUIStore((s) => s.introReplay);
  const dismissIntro = () => {
    setIntroSeen(true);
    useUIStore.getState().setIntroReplay(false);
    AsyncStorage.setItem(INTRO_KEY, 'true').catch(() => {});
  };

  // A user who opened an invite link came to join a crew: skip the intro for good.
  const skipIntro = introSeen === false && shouldSkipIntro(segments[0]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- dismisses the intro once when an invite link opens
    if (skipIntro) dismissIntro();
  }, [skipIntro]);

  // Wait for Zustand persist to rehydrate from AsyncStorage, then restore
  // the bearer token into the API client's in-memory state so that
  // checkSession (and all subsequent requests) include the Authorization
  // header.
  useEffect(() => {
    // The synchronous-hydration case is handled by the lazy initializer above;
    // here we only need to react to async rehydration finishing. Subscribing is
    // still safe if hydration already completed — the callback simply won't fire.
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      const token = useAuthStore.getState().userToken;
      if (token) {
        setAuthToken(token);
      }
      setHydrated(true);
    });
    return unsub;
  }, []);

  // Once hydrated, validate the session against the server.
  useEffect(() => {
    if (hydrated) {
      checkSession();
    }
  }, [hydrated, checkSession]);

  // Redirect based on auth state once persist has rehydrated. Gating on
  // `hydrated` (not `sessionChecked`) is what keeps this guard honest now that
  // first paint no longer waits on the server: the persisted user is the
  // correct optimistic answer, so a guest is bounced off a gated route on the
  // first frame instead of after a round trip, and a signed-in user is never
  // bounced to login just because the network is slow. When checkSession later
  // confirms or clears `user`, this effect re-runs on that change and
  // re-applies the guard. It must NOT run before hydration — `user` is null
  // then, which would read every signed-in user as a guest. Calling
  // router.replace before the navigator is mounted throws "Attempted to navigate
  // before mounting the Root Layout component" and wedges the app on the native
  // splash. Guarding on navState.key alone is NOT enough — that key is populated
  // a tick before navigationRef.isReady() returns true, so a replace fired from
  // this commit's passive-effect phase still hits the assertIsReady check.
  // Deferring to the next frame pushes the navigation past mount, by which point
  // the navigator is genuinely ready.
  useEffect(() => {
    if (!navState?.key) return;
    if (!hydrated) return;

    const raf = requestAnimationFrame(() => {
      const inAuthGroup = segments[0] === '(auth)';
      // Which routes a guest may open is documented on isGuestBlocked.
      const seg = segments as string[];
      const guestBlocked = isGuestBlocked(seg);
      const adminBlocked = seg[0] === 'admin' && !!user && !isAdmin;
      if (!user && guestBlocked && !inAuthGroup) {
        // The account tab is the sign-in entry itself, so there is no page to return to.
        if (seg[1] !== 'account') setReturnTo(pathname);
        router.replace('/(auth)/login');
      } else if (adminBlocked) {
        router.replace('/(tabs)');
      } else if (user && inAuthGroup) {
        router.replace((takeReturnTo() ?? '/(tabs)') as Href);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [user, isAdmin, hydrated, segments, pathname, router, navState?.key]);

  // The navigator (Stack) MUST be mounted on the very first render so the
  // redirect effect above can navigate safely. So rather than swapping the
  // whole tree for a bare splash View while hydration runs (which leaves no
  // navigator mounted), keep the Stack mounted and lay the splash spinner over
  // it until we're ready.
  // Fonts are cosmetic — never let a font failure hard-block interaction; treat
  // a useFonts() error as "ready" so it can't pin the splash. The bootTimedOut
  // ceiling is the final backstop for any other hang.
  const fontsReady = fontsLoaded || !!fontError;
  // First paint waits on LOCAL work only — persist rehydration (auth + theme) and fonts. The
  // store is persisted (user/userToken/isAdmin), so the app paints from the
  // restored session and lets checkSession reconcile behind an already
  // interactive UI; blocking here put a network round trip in front of every
  // launch, guests included. The redirect effect above now gates on `hydrated`
  // for exactly this reason — see its comment.
  const loading = (!hydrated || !uiHydrated || !fontsReady) && !bootTimedOut;
  const introShowing = !loading && (introReplay || (introSeen === false && !skipIntro));
  useQueueDrain(!loading);
  useOtaUpdatePrompt();

  // Dismiss the native splash as soon as loading resolves. The overlay below
  // stays as a fallback (same #0a0a0a bg) so any frame gap is invisible. The
  // 4s bootTimedOut ceiling already triggers `loading = false`, so hideAsync
  // is always called eventually even if fonts or rehydration hang.
  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [loading]);

  // Keep the root view / Android system navigation bar background in step with
  // the active theme (the module-scope call above only covers the stage default).
  const rootBackground = (theme === 'daylight' ? colorsDaylight : stageColors).bg.primary;
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(rootBackground).catch(() => {});
  }, [rootBackground]);

  // Makes iOS-drawn alerts, sheets and the keyboard follow the painted theme. In Match system
  // mode the override is cleared ('unspecified') so useColorScheme reports the real OS scheme, which
  // is then applied to the theme. Needs app.json userInterfaceStyle 'automatic'.
  useEffect(() => {
    Appearance.setColorScheme(followSystemTheme ? 'unspecified' : theme === 'daylight' ? 'light' : 'dark');
  }, [theme, followSystemTheme]);
  useEffect(() => {
    if (uiHydrated) applySystemScheme(systemScheme);
  }, [applySystemScheme, followSystemTheme, systemScheme, uiHydrated]);

  return (
    <View style={styles.appShell}>
      {/* Light-content status bar on the dark stage theme; dark content on the
          light daylight theme so the icons stay readable against either bg. The
          offline banner paints behind the status bar with ink of the opposite polarity
          (bg.primary on an accent fill), so the icons flip while it shows. */}
      <StatusBar style={(theme === 'daylight') !== bannerActive ? 'dark' : 'light'} />
      {!loading && <OfflineBanner onActiveChange={setBannerActive} />}
      {!loading && <SosBanner padTop={!bannerActive} onActiveChange={setSosActive} />}
      {!loading && <LiveSharePublisher />}
      {!loading && <AnnouncementBanner padTop={!bannerActive && !sosActive} onActiveChange={setAnnounceActive} />}
      <TopBannerContext.Provider value={bannerActive || sosActive || announceActive}>
        <View
          style={styles.appShell}
          // Keep TalkBack inside the overlay (splash or intro) that visually covers the app.
          importantForAccessibility={loading || introShowing ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={loading || introShowing}
        >
          {/* Use expo-router's global router singleton (not the local useRouter
              instance): the root boundary sits OUTSIDE the Stack, so it must
              navigate imperatively rather than via router context. */}
          <ErrorBoundary onEscape={() => globalRouter.replace('/(tabs)')}>
          {/*
            Default headerShown:false — tabs/auth manage their own chrome. But
            several pushed routes (map, compass, plan-share, crew-plan,
            crew-compare, festival-mode, wrap) flip headerShown:true with just a
            title; these themed header defaults ensure that WHEN a header shows it
            matches the app's background instead of the native white bar.
            contentStyle keeps the screen body on the theme background so there's
            no white flash between transitions. The StatusBar style follows the
            theme (light content on stage, dark content on daylight).
          */}
          <Stack
            screenOptions={{
              headerShown: false,
              // The '(tabs)' group has no title, so iOS showed the route name as the back label.
              headerBackButtonDisplayMode: 'minimal',
              // ELEVATED-HEADER RULE (design decision, 2026-07-15): pushed-route
              // native headers sit one tonal step ABOVE the body — header
              // bg.secondary (#1a1a1a) over content bg.primary (#0a0a0a). This is
              // a deliberate depth cue, NOT drift. Do not flatten header→primary;
              // if unifying chrome elevation, converge on bg.secondary/bg.elevated.
              headerStyle: { backgroundColor: colors.bg.secondary },
              headerTintColor: colors.text.primary,
              // headerTitleStyle cannot set fontFamily on Android (the native
              // header ignores it), so a raw fontWeight here would trigger
              // synthetic bold and clip trailing glyphs. Use the HeaderTitle
              // component below instead — it resolves SpaceGrotesk_600SemiBold
              // via typeStyle and renders with adjustsFontSizeToFit for long names.
              headerTitleStyle: {
                color: colors.text.primary,
                fontSize: fontSize[18],
              },
              // Custom title node: sets the weighted font family correctly on
              // both platforms (Android can't inherit fontFamily from headerTitleStyle).
              headerTitle: ({ children }: { children: string }) => (
                <HeaderTitle>{children}</HeaderTitle>
              ),
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg.primary },
              // Enable the iOS left-edge swipe-back gesture on every pushed
              // route (set detail, map, compass, crew-plan, etc.). It's the
              // platform-expected way to dismiss a screen on iOS; no-op on
              // Android (which uses the system back button / predictive back).
              gestureEnabled: true,
            }}
          >
            {/*
              H9 — Tighten the iOS swipe-back recognition zone for the tabs
              screen. The Schedule tab's horizontal stage carousel (TimelineView)
              has its first column starting at ~12pt from the left edge, which
              falls inside iOS's default ~20pt pop-gesture recognition area.
              Narrowing gestureResponseDistance to 8pt means the pop gesture only
              activates from the extreme edge; the FlatList handles everything
              else. Back navigation is NOT disabled — a hard left-edge swipe still
              works normally. No-op on Android (predictive back is unaffected).
            */}
            <Stack.Screen name="(tabs)" options={{ gestureResponseDistance: { start: 8 } }} />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="grid" options={{ headerBackTitle: 'Lineup' }} />
            <Stack.Screen
              name="set/[setId]"
              options={{
                // Native form sheet (SDK 56): real grabber + peek/expand detents,
                // so the screen's own faux drag handle is removed. Half-height
                // peek lets users glance a set without losing their lineup scroll.
                presentation: 'formSheet',
                sheetAllowedDetents: [0.5, 1.0],
                sheetGrabberVisible: true,
                headerShown: false,
                headerTintColor: colors.text.primary,
              }}
            />
            <Stack.Screen
              name="meeting-point-new"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.6, 1.0],
                sheetGrabberVisible: true,
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="privacy"
              options={{ presentation: 'card', headerShown: true, title: 'Privacy Policy' }}
            />
            <Stack.Screen name="reset-password" options={{ presentation: 'card', headerShown: false }} />
          </Stack>
          </ErrorBoundary>
        </View>
      </TopBannerContext.Provider>
      {!loading && <Toaster />}
      <ArtistSheetHost />
      {loading && (
        <View style={[StyleSheet.absoluteFill, styles.splash, { backgroundColor: colors.bg.primary }]} pointerEvents="auto">
          <ActivityIndicator size="large" color={colors.accent.aqua} />
        </View>
      )}
      {introShowing && <FirstRunIntro onDone={dismissIntro} />}
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appShell: {
    flex: 1,
  },
});

function RootLayout() {
  return (
    <SafeAreaProvider>
      <UIProvider>
        <AuthGate />
      </UIProvider>
    </SafeAreaProvider>
  );
}

// Sentry.wrap adds the error boundary + perf instrumentation; it's a safe
// pass-through when Sentry isn't initialized (no DSN configured). Skip it in
// Expo Go where the native module is absent.
export default isExpoGo ? RootLayout : Sentry.wrap(RootLayout);
