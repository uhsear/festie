import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '@festie/shared/stores';
import { useActiveSos, useLiveLocationCrewSync } from '@festie/shared/hooks';
import { sosHeadline, sosSeenLabel, sosWhen } from '@festie/shared/utils';
import { duration, durationEffects, durationSpatial } from '@festie/shared/tokens';
import { makeStyles, typeStyle, useTokens, iconSize } from '../hooks/useTokens';
import { useNow } from '../hooks/useNow';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { sosBannerHref } from '../lib/dayOfRoutes';
import AppPressable from './AppPressable';

/** Same hold as the web banner: two flashes, then two seconds, before it shrinks to a one-line strip. */
const FULL_WIDTH_MS = duration.slow * 2 + 2_000;

/** The strip's own line is 16 pt, so it grows to this; the header below pads by the overlay height. */
const MIN_TAP_TARGET = 44;

interface SosBannerProps {
  /** Pad for the status bar. False when a bar above (OfflineBanner) already does. */
  padTop: boolean;
  /** Reports whether the banner or its strip is showing, so the chrome applies the top inset once. */
  onActiveChange?: (active: boolean) => void;
}

/**
 * App-wide SOS banner, mounted at the root under the OfflineBanner. While any
 * crew member's SOS is active it shows on every screen in filled coral
 * (coralStrong behind white, the AA-safe fill), names who and when, and opens
 * the on-device compass at a lone raiser, else the crew logistics tab, in one tap. It has no
 * dismiss control: it clears when the SOS does. Screen readers hear it once
 * per change in who raised an SOS, not on every minute tick. It slides in at the medium spatial
 * duration and flashes coral twice for each new raiser; Reduce Motion shows it with neither.
 * It floats over the screen from the root overlay, so its arrival never moves the content below.
 * After FULL_WIDTH_MS it shrinks to a one-line strip with a 44 pt tap target. The root overlay reports its height
 * (TopBannerContext), so a screen header pads below it and no header title or control is covered.
 */
export default function SosBanner({ padTop, onActiveChange }: SosBannerProps) {
  const t = useTokens();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  useLiveLocationCrewSync();
  const entries = useActiveSos();
  const selfId = useAuthStore((st) => st.user?.id);
  useNow(60_000); // keeps "SOS 4m ago" current
  const reduceMotion = useReduceMotion();
  const flash = useSharedValue(0);

  const active = entries.length > 0;
  const headline = sosHeadline(entries, selfId);

  const newest = entries[0];
  const arrivalKey = newest ? `${newest.userId}|${newest.raisedAt}` : null;
  // The arrival that has already shrunk, so a new raiser is full width again without a reset.
  const [compactFor, setCompactFor] = useState<string | null>(null);
  const compact = arrivalKey !== null && compactFor === arrivalKey;
  useEffect(() => {
    if (!arrivalKey) return;
    const id = setTimeout(() => setCompactFor(arrivalKey), FULL_WIDTH_MS);
    return () => clearTimeout(id);
  }, [arrivalKey]);

  useEffect(() => {
    onActiveChange?.(active);
    return () => onActiveChange?.(false);
  }, [active, onActiveChange]);

  useEffect(() => {
    if (headline) AccessibilityInfo.announceForAccessibility(headline);
  }, [headline]);

  useEffect(() => {
    if (!arrivalKey || reduceMotion) return;
    const half = durationEffects.fast;
    flash.value = withRepeat(withSequence(withTiming(0.6, { duration: half }), withTiming(0, { duration: half })), 2);
    return () => cancelAnimation(flash);
  }, [arrivalKey, reduceMotion, flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  if (!active) return null;
  if (!newest) return null;
  const topInset = padTop ? insets.top : 0;
  const own = newest.userId === selfId;
  const href = sosBannerHref(entries, selfId);
  const toCompass = typeof href !== 'string' && href.pathname === '/compass';
  const when = sosWhen(entries) + (own ? ` · ${sosSeenLabel(newest)}` : '');

  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(durationSpatial.med)}>
      <AppPressable
        style={compact ? [s.strip, { paddingTop: topInset, minHeight: topInset + MIN_TAP_TARGET }] : [s.banner, { paddingTop: topInset + t.spacing[2] }]}
        onPress={() => router.push(href)}
        accessibilityRole="button"
        accessibilityLabel={`${headline}, ${when}. ${toCompass ? 'Open the compass to find them' : 'Open crew to find them'}`}
        rippleColor={t.colors.shade[9]}
      >
        <Ionicons name="alert-circle" size={compact ? iconSize.compact : iconSize.md} color={t.colors.text.onAccent} />
        {compact ? (
          <Text style={s.stripText}>{headline}</Text>
        ) : (
          <>
            <View style={s.body}>
              <Text style={s.headline}>{headline}</Text>
              <Text style={s.when}>{when}</Text>
            </View>
            <Text style={s.cta}>Find</Text>
            <Ionicons name="chevron-forward" size={iconSize.sm} color={t.colors.text.onAccent} />
          </>
        )}
        <Animated.View pointerEvents="none" style={[s.flash, flashStyle]} />
      </AppPressable>
    </Animated.View>
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
  // One caption line below the status bar: it ends where a screen header's own top padding ends.
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    backgroundColor: t.colors.accent.coralStrong,
  },
  stripText: {
    ...typeStyle('caption', 700),
    color: t.colors.text.onAccent,
    flex: 1,
  },
  flash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: t.colors.accent.coral,
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
