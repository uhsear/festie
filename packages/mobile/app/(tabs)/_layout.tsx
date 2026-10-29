import { NativeTabs } from 'expo-router/native-tabs';
import { colors } from '@festie/shared/tokens';
import { useUIStore } from '@festie/shared/stores';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useTokens } from '../../hooks/useTokens';

/**
 * Native bottom tabs (expo-router/native-tabs, SDK 55+). Replaces the
 * hand-rolled JS <Tabs> bar: gets the iOS 26 liquid-glass / Android Material 3
 * tab bar, native haptics, and AUTOMATIC bottom safe-area insets — so the
 * per-screen `tabBarBottomInset` math and the Schedule `overflow:'hidden'`
 * tab-bar-bleed workaround are no longer load-bearing.
 *
 * `tintColor` keeps the brand accent rule (aqua = primary/selection) and follows
 * the active theme (daylight aqua is the darkened #00594f). Tab labels
 * are the canonical names (Schedule/Picks/Crew/Account). Web falls back to the JS
 * <Tabs> in _layout.web.tsx (NativeTabs is native-only; eas update still bundles
 * web for the mobile package).
 */
export default function TabLayout() {
  const { colors } = useTokens();
  const daylight = useUIStore((s) => s.theme) === 'daylight';
  // Stage keeps the system-styled bar. Daylight pins a light bar with muted /
  // aqua icons and labels, so a dark OS appearance cannot give the dark #00594f
  // tint a dark bar.
  const daylightBar = daylight
    ? {
        backgroundColor: colors.bg.secondary,
        iconColor: { default: colors.text.muted, selected: colors.accent.aqua },
        labelStyle: { default: { color: colors.text.muted }, selected: { color: colors.accent.aqua } },
        // Android's Material pill otherwise stays the dark-theme grey on a light bar.
        indicatorColor: colors.aquaAlpha[15],
      }
    : null;
  // Connect Socket.IO when the user is on the main tabs (authenticated). Events
  // flow into the shared Zustand stores automatically. Must stay mounted here.
  useRealtimeSync();

  // All four tabs stay visible for guests: the Account tab is the sign-in entry
  // (it routes a guest to /login), and Picks/Crew advertise the features +
  // gate via AuthGate (crew shows an in-place "Sign in required" state). Hiding
  // them for guests removed the only discoverable sign-in path, so they stay.

  return (
    <NativeTabs
      tintColor={colors.accent.aqua}
      minimizeBehavior="onScrollDown"
      labelVisibilityMode="labeled"
      {...daylightBar}
    >
      <NativeTabs.Trigger name="index">
        {/* calendar has no plain `.fill` cut in SF Symbols, so the circle pair
            gives the same outline→fill selected feedback as the other tabs
            instead of an unchanged glyph on select. */}
        <NativeTabs.Trigger.Icon sf={{ default: 'calendar.circle', selected: 'calendar.circle.fill' }} md="event" />
        <NativeTabs.Trigger.Label>Schedule</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="picks">
        <NativeTabs.Trigger.Icon sf={{ default: 'star', selected: 'star.fill' }} md="star" />
        <NativeTabs.Trigger.Label>Picks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="crew">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
        <NativeTabs.Trigger.Label>Crew</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          md="person"
        />
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
