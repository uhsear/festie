import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, type ScrollViewInstance } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CREW_TABS, type CrewTabKey } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, useLargeText, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useReduceMotion } from '../hooks/useReduceMotion';

export type { CrewTabKey };

// Keys and labels come from @festie/shared so web and mobile stay in step.
// 'Find' owns the mid-festival "where is everyone / where do we meet" cluster
// (SOS, live location, meeting points) and is the default tab.
const TAB_ICONS: Record<CrewTabKey, keyof typeof Ionicons.glyphMap> = {
  find: 'location-outline',
  members: 'people-outline',
  plan: 'calendar-outline',
  money: 'cash-outline',
};

interface CrewTabBarProps {
  activeTab: CrewTabKey;
  onTabChange: (tab: CrewTabKey) => void;
  /**
   * Per-tab badge content rendered after the label. A number renders a small
   * count pill; `true` renders a dot indicator. Falsy values render nothing.
   */
  badges?: Partial<Record<CrewTabKey, number | boolean>>;
}

/**
 * P1-2 — segmented Crew tab bar (mobile mirror of web's CrewTabBar). Splits the
 * crew screen's many sections into Find / Members / Plan / Money tabs so
 * the screen reads as tabs instead of one long scroll. Horizontally scrollable
 * for narrow phones; each tab is a >=44pt touch target. Coral is reserved for
 * the badges (open polls / unsettled balance), matching the web pattern.
 *
 * The active pill (aqua border + tint) is the only selection cue. The R14
 * sliding bar above it was removed on owner feedback (2026-10-29): it doubled
 * the highlight.
 */
export default function CrewTabBar({ activeTab, onTabChange, badges }: CrewTabBarProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const reduceMotion = useReduceMotion();
  const largeText = useLargeText();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const xs = useRef<Record<string, number>>({});

  // Keep the active tab in view when it changes (narrow phones / large text).
  useEffect(() => {
    const x = xs.current[activeTab];
    if (x != null) scrollRef.current?.scrollTo({ x: Math.max(0, x - 16), animated: !reduceMotion });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reduceMotion only sets animation, not when to scroll
  }, [activeTab]);

  // Light selection tick when switching to a different tab — the segmented bar
  // feels physical, and a no-op re-tap (same tab) stays silent.
  const handlePress = (key: CrewTabKey) => {
    if (key !== activeTab) haptics.select();
    onTabChange(key);
  };

  return (
    <View style={styles.barOuter}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bar}
        accessibilityRole="tablist"
      >
        {CREW_TABS.map((tab) => {
          const active = tab.key === activeTab;
          const badge = badges?.[tab.key];
          return (
            <TouchableOpacity
              key={tab.key}
              onLayout={(e) => {
                xs.current[tab.key] = e.nativeEvent.layout.x;
              }}
              testID={`crew-tab-${tab.key}`}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => handlePress(tab.key)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={
                typeof badge === 'number' && badge > 0
                  ? `${tab.label}, ${badge} open`
                  : badge === true
                    ? `${tab.label}, needs attention`
                    : tab.label
              }
            >
              {/* DC25: 15 is off-grid; snap to iconSize.sm (16). */}
              <Ionicons name={TAB_ICONS[tab.key]} size={16} color={active ? t.colors.accent.aqua : t.colors.text.secondary} />
              {!largeText || active ? (
                <Text style={[styles.label, active && styles.labelActive]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {tab.label}
                </Text>
              ) : null}
              {typeof badge === 'number' && badge > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {badge}
                  </Text>
                </View>
              ) : badge === true ? (
                <View style={styles.dotBadge} />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // Wrapper: pins bar to content height (same intent as the old flexGrow:0 on
  // the bare ScrollView).
  barOuter: {
    flexGrow: 0,
  },
  bar: {
    flexDirection: 'row',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[2],
    // Fill the viewport when the four tabs fit (the common phone case) so the
    // bar has no dead horizontal scroll; it still scrolls on narrow screens.
    flexGrow: 1,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44, // WCAG 2.5.5 / Apple HIG minimum touch target
    minWidth: 44, // icon-only tabs under large text are ~42pt wide without this
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  tabActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  label: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  labelActive: {
    color: t.colors.accent.aqua,
  },
  countBadge: {
    minWidth: 18,
    paddingHorizontal: t.spacing[1],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    // Open-polls count is "attention, not alarm" — aqua per the accent rule
    // (coral is reserved for danger/SOS only).
    backgroundColor: t.colors.aquaAlpha[15],
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  dotBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.accent.coral,
  },
}));
