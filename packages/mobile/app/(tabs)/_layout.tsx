import { NativeTabs, type MaterialIcon, type SFSymbolIcon } from 'expo-router/native-tabs';
import { colors } from '@festie/shared/tokens';
import { useUIStore } from '@festie/shared/stores';
import { APP_SECTIONS, type AppSectionKey } from '@festie/shared/utils';
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
 * the active theme (daylight aqua is the darkened #00594f). Tab labels and
 * order come from the shared APP_SECTIONS (Lineup/My Plan/Crew/Map/More), so
 * web and mobile name the sections the same. Five is the iOS limit before the
 * system "More" overflow: do not add a sixth. Web falls back to the JS
 * <Tabs> in _layout.web.tsx (NativeTabs is native-only; eas update still bundles
 * web for the mobile package).
 */
// calendar has no plain `.fill` cut in SF Symbols, so the circle pair gives the
// same outline→fill selected feedback as the other tabs instead of an unchanged
// glyph on select.
const TAB_ROUTES: Record<AppSectionKey, { name: string; sf: SFSymbolIcon['sf']; md: MaterialIcon['md'] }> = {
  lineup: { name: 'index', sf: { default: 'calendar.circle', selected: 'calendar.circle.fill' }, md: 'event' },
  myPlan: { name: 'picks', sf: { default: 'star', selected: 'star.fill' }, md: 'star' },
  crew: { name: 'crew', sf: { default: 'person.2', selected: 'person.2.fill' }, md: 'group' },
  map: { name: 'map', sf: { default: 'map', selected: 'map.fill' }, md: 'map' },
  more: {
    name: 'account',
    sf: { default: 'person.crop.circle', selected: 'person.crop.circle.fill' },
    md: 'person',
  },
};

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

  // All five tabs stay visible for guests: the More tab is the sign-in entry
  // (it routes a guest to /login), Map shows stages and amenities, and My Plan/Crew advertise the features +
  // gate via AuthGate (crew shows an in-place "Sign in required" state). Hiding
  // them for guests removed the only discoverable sign-in path, so they stay.

  return (
    <NativeTabs
      tintColor={colors.accent.aqua}
      minimizeBehavior="onScrollDown"
      labelVisibilityMode="labeled"
      {...daylightBar}
    >
      {APP_SECTIONS.map(({ key, label }) => {
        const route = TAB_ROUTES[key];
        return (
          <NativeTabs.Trigger key={key} name={route.name}>
            <NativeTabs.Trigger.Icon sf={route.sf} md={route.md} />
            <NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        );
      })}
    </NativeTabs>
  );
}
