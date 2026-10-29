import { useEffect } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '@festie/shared/stores';
import { useActiveSos, useLiveLocationCrewSync } from '@festie/shared/hooks';
import { sosHeadline, sosWhen } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, iconSize } from '../hooks/useTokens';
import { useNow } from '../hooks/useNow';
import { CREW_MEET_HREF } from '../lib/dayOfRoutes';
import AppPressable from './AppPressable';

interface SosBannerProps {
  /** Pad for the status bar. False when a bar above (OfflineBanner) already does. */
  padTop: boolean;
  /** Reports whether the banner is showing, so the chrome applies the top inset once. */
  onActiveChange?: (active: boolean) => void;
}

/**
 * App-wide SOS banner, mounted at the root under the OfflineBanner. While any
 * crew member's SOS is active it shows on every screen in filled coral
 * (coralStrong behind white, the AA-safe fill), names who and when, and opens
 * the crew logistics tab (SOS, live map, meeting points) in one tap. It has no
 * dismiss control: it clears when the SOS does. Screen readers hear it once
 * per change in who raised an SOS, not on every minute tick.
 */
export default function SosBanner({ padTop, onActiveChange }: SosBannerProps) {
  const t = useTokens();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  useLiveLocationCrewSync();
  const entries = useActiveSos();
  const selfId = useAuthStore((st) => st.user?.id);
  useNow(60_000); // keeps "SOS 4m ago" current

  const active = entries.length > 0;
  const headline = sosHeadline(entries, selfId);

  useEffect(() => {
    onActiveChange?.(active);
    return () => onActiveChange?.(false);
  }, [active, onActiveChange]);

  useEffect(() => {
    if (headline) AccessibilityInfo.announceForAccessibility(headline);
  }, [headline]);

  if (!active) return null;
  const when = sosWhen(entries);

  return (
    <AppPressable
      style={[s.banner, { paddingTop: (padTop ? insets.top : 0) + t.spacing[2] }]}
      onPress={() => router.push(CREW_MEET_HREF)}
      accessibilityRole="button"
      accessibilityLabel={`${headline}, ${when}. Open crew to find them`}
      rippleColor={t.colors.shade[9]}
    >
      <Ionicons name="alert-circle" size={iconSize.md} color={t.colors.text.onAccent} />
      <View style={s.body}>
        <Text style={s.headline}>{headline}</Text>
        <Text style={s.when}>{when}</Text>
      </View>
      <Text style={s.cta}>Find</Text>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={t.colors.text.onAccent} />
    </AppPressable>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[2],
    minHeight: 48,
    backgroundColor: t.colors.accent.coralStrong,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: t.spacing[2],
  },
  headline: {
    ...typeStyle('label', 700),
    color: t.colors.text.onAccent,
  },
  when: {
    ...typeStyle('numeral'),
    color: t.colors.text.onAccent,
  },
  cta: {
    ...typeStyle('label', 600),
    color: t.colors.text.onAccent,
  },
}));
