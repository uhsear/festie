/**
 * No-op stub of the iOS Live Activity + home-screen widget for Android and web.
 *
 * `NowNextActivity.ios.tsx` uses `expo-widgets` + `@expo/ui/swift-ui`. On web
 * they have no implementation (they call `requireNativeViewManager`, crashing
 * the bundle). On Android, SDK 58's expo-widgets ships a native module but no
 * `LiveActivityFactory`, so `createLiveActivity` throws "undefined cannot be
 * used as a constructor" at import and crash-loops the app at launch.
 * Metro resolves `.ios.tsx` ahead of this file on iOS only, so
 * `useOngoingNotification` gets a harmless no-op everywhere else.
 *
 * Live Activities and this home-screen widget are iOS-only, so a no-op is the
 * correct behaviour, not just a testing shim.
 */
type NowNextSnapshot = { title: string; subtitle: string; endsAt?: string | null };

export const NowNextWidgetInstance = {
  updateSnapshot: (_snapshot: NowNextSnapshot): void => {},
};

export default {};
