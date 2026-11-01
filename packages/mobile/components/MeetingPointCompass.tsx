// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * MeetingPointCompass.tsx — M5 proximity compass (mobile-only).
 *
 * Points an on-screen arrow at a SAVED meeting-point coord and shows the
 * straight-line distance. Heading (true north when known) and the viewer's
 * position both come from expo-location watchers, so distance and arrow update
 * as you walk; the bearing/distance math is the pure shared geo util.
 *
 * OFFLINE-HONEST: this is 100% on-device and uses ZERO network. The distance is
 * straight-line ("as the crow flies") to a point YOU saved, not a routed or
 * live position — the copy says so. It is never presented as real-time tracking
 * of another person.
 *
 * Graceful degradation: permission-denied, sensor-unavailable, and no-coords
 * (legacy free-text meeting point) states each render an honest explanation
 * instead of a spinning or bogus arrow.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { bearing, haversineDistance, relativeArrowAngle, formatDistance, etaMinutes } from '@festie/shared/utils';
import type { Coord } from '@festie/shared/utils';
import { useFestivalModeStore } from '@festie/shared/stores';
import { headingFromReading, needsCalibration, smoothHeading } from '../lib/compass';
import Button from './Button';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import DisplayWords from './DisplayWords';
import { useReduceMotion } from '../hooks/useReduceMotion';

/** A saved meeting-point target: a label plus its captured coords. */
export interface MeetingPointTarget {
  label: string;
  latitude: number;
  longitude: number;
}

interface MeetingPointCompassProps {
  target: MeetingPointTarget;
}

const SMOOTHING_ALPHA = 0.15; // low-pass factor — small = calm needle
const REDUCE_MOTION_INTERVAL_MS = 400;
const NO_FIX_TIMEOUT_MS = 20_000;
// A device without a magnetometer often subscribes fine and then never emits.
const NO_HEADING_TIMEOUT_MS = 5_000;

type Phase = 'init' | 'denied' | 'no-sensor' | 'no-fix' | 'no-coords' | 'ready';

export default function MeetingPointCompass({ target }: MeetingPointCompassProps) {
  const t = useTokens();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();

  // Memoized on the coord primitives so its identity is stable across renders;
  // this lets the sensor/GPS effects depend on `targetCoord` directly (they only
  // re-subscribe when the actual lat/lng change, not on every render).
  const targetCoord: Coord | null = useMemo(
    () =>
      Number.isFinite(target.latitude) && Number.isFinite(target.longitude)
        ? { latitude: target.latitude, longitude: target.longitude }
        : null,
    [target.latitude, target.longitude],
  );

  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  const [phase, setPhase] = useState<Phase>(targetCoord ? 'init' : 'no-coords');
  // Smoothed, degrees CW from north; null until the first reading so the arrow
  // never points as if the phone faced north.
  const [heading, setHeading] = useState<number | null>(null);
  const [origin, setOrigin] = useState<Coord | null>(null);
  const [calibrate, setCalibrate] = useState(false);
  const [retry, setRetry] = useState(0);
  const smoothedRef = useRef<number | null>(null);

  // ── Permission, then GPS + heading watchers ──────────────────────────────
  useEffect(() => {
    if (!targetCoord) return;
    let cancelled = false;
    let hasOrigin = false;
    let hasHeading = false;
    let posSub: Location.LocationSubscription | null = null;
    let headSub: Location.LocationSubscription | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let headingTimer: ReturnType<typeof setTimeout> | null = null;
    let lastHeadingAt = 0;

    const noFix = () => {
      if (!cancelled && !hasOrigin) setPhase('no-fix');
    };

    (async () => {
      let granted = false;
      try {
        granted = (await Location.requestForegroundPermissionsAsync()).granted;
      } catch {
        granted = false;
      }
      if (cancelled) return;
      if (!granted) {
        setPhase('denied');
        return;
      }

      timer = setTimeout(noFix, NO_FIX_TIMEOUT_MS);
      const onFix = (pos: Location.LocationObject) => {
        if (cancelled) return;
        hasOrigin = true;
        if (timer) clearTimeout(timer);
        setOrigin({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setPhase((p) => (p === 'no-sensor' ? p : 'ready'));
      };
      const opts = lowPowerMode
        ? { accuracy: Location.Accuracy.Balanced, distanceInterval: 3, timeInterval: 10000 }
        : { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 4000 };
      try {
        const sub = await Location.watchPositionAsync(opts, onFix, noFix);
        if (cancelled) sub.remove();
        else posSub = sub;
      } catch {
        noFix();
      }
      if (cancelled) return;

      headingTimer = setTimeout(() => {
        if (!cancelled && !hasHeading) setPhase((p) => (p === 'no-fix' ? p : 'no-sensor'));
      }, NO_HEADING_TIMEOUT_MS);
      try {
        const sub = await Location.watchHeadingAsync((h) => {
          if (cancelled) return;
          if (!hasHeading) {
            hasHeading = true;
            if (headingTimer) clearTimeout(headingTimer);
            setPhase((p) => (p === 'no-sensor' ? (hasOrigin ? 'ready' : 'init') : p));
          }
          const next = smoothHeading(smoothedRef.current, headingFromReading(h), SMOOTHING_ALPHA);
          smoothedRef.current = next;
          setCalibrate(needsCalibration(h.accuracy));
          // Reduce-motion: slow the needle to ~2.5fps to avoid continuous fast rotation.
          const now = Date.now();
          if (reduceMotion && now - lastHeadingAt < REDUCE_MOTION_INTERVAL_MS) return;
          lastHeadingAt = now;
          setHeading(next);
        });
        if (cancelled) sub.remove();
        else headSub = sub;
      } catch {
        if (headingTimer) clearTimeout(headingTimer);
        if (!cancelled) setPhase((p) => (p === 'no-fix' ? p : 'no-sensor'));
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (headingTimer) clearTimeout(headingTimer);
      posSub?.remove();
      headSub?.remove();
    };
  }, [targetCoord, reduceMotion, lowPowerMode, retry]);

  // ── Derived bearing / distance / arrow rotation ──────────────────────────
  const brng = origin && targetCoord ? bearing(origin, targetCoord) : NaN;
  const distanceM = origin && targetCoord ? haversineDistance(origin, targetCoord) : NaN;
  const arrowAngle = heading == null ? NaN : relativeArrowAngle(brng, heading);
  const hasFix = Number.isFinite(arrowAngle);
  const eta = etaMinutes(origin, targetCoord);

  // ── Non-ready states ─────────────────────────────────────────────────────
  if (phase === 'no-coords') {
    return (
      <View style={styles.stateCard}>
        {/* hero exception: full-screen state glyph, not a token-scale icon */}
        <Ionicons name="navigate-outline" size={40} color={t.colors.text.muted} />
        <Text style={styles.stateTitle}>No saved coordinates</Text>
        <Text style={styles.stateBody}>
          “{target.label}” is a text-only meeting point. Re-save it with a captured location to use the compass.
        </Text>
      </View>
    );
  }

  if (phase === 'denied') {
    return (
      <View style={styles.stateCard}>
        {/* hero exception: full-screen state glyph, not a token-scale icon */}
        <Ionicons name="location-outline" size={40} color={t.colors.accent.amber} />
        <Text style={styles.stateTitle}>Location permission needed</Text>
        <Text style={styles.stateBody}>
          The compass needs your location to point toward “{target.label}”. Enable location access in Settings, then
          reopen this screen.
        </Text>
      </View>
    );
  }

  if (phase === 'no-fix') {
    return (
      <View style={styles.stateCard}>
        {/* hero exception: full-screen state glyph, not a token-scale icon */}
        <Ionicons name="location-outline" size={40} color={t.colors.accent.amber} />
        <Text style={styles.stateTitle}>Can’t get a GPS fix</Text>
        <Text style={styles.stateBody}>Move into the open and try again.</Text>
        <Button label="Try again" onPress={() => {
            setPhase('init');
            setRetry((n) => n + 1);
          }} />
      </View>
    );
  }

  if (phase === 'no-sensor') {
    return (
      <View style={styles.stateCard}>
        {/* hero exception: full-screen state glyph, not a token-scale icon */}
        <Ionicons name="compass-outline" size={40} color={t.colors.text.muted} />
        <Text style={styles.stateTitle}>No compass on this device</Text>
        <Text style={styles.stateBody}>
          This device has no compass, so the arrow can’t show which way you’re facing. The distance below is still
          accurate.
        </Text>
        <Text
          style={styles.distance}
          accessibilityRole="text"
          accessibilityLabel={`${formatDistance(distanceM)} to ${target.label}, straight-line distance`}
        >
          <DisplayWords text={formatDistance(distanceM)} fontSize={styles.distance.fontSize} />
        </Text>
      </View>
    );
  }

  if (phase === 'init' || !hasFix) {
    return (
      <View style={styles.stateCard}>
        <ActivityIndicator color={t.colors.accent.aqua} />
        <Text style={styles.stateBody}>Getting your bearings…</Text>
      </View>
    );
  }

  // ── Ready: arrow + distance ──────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Text style={styles.label} numberOfLines={2}>
        {target.label}
      </Text>

      {/*
        a11y: The dial is a decorative, animated visual aid — the arrow rotates
        with the live compass heading, which a static image role/label can
        neither convey nor keep current. So the dial itself is hidden from the
        a11y tree (importantForAccessibility/accessibilityElementsHidden) and the
        meaningful distance is surfaced as text below. It is not a live region:
        distance stays fixed during heading updates, so repeated announcements
        on every heading tick would drown out navigation.
      */}
      <View style={styles.dial} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={[styles.arrow, { transform: [{ rotate: `${arrowAngle}deg` }] }]}>
          {/* hero exception: the compass dial's arrow, not a token-scale icon */}
          <Ionicons name="navigate" size={96} color={t.colors.accent.aqua} />
        </View>
      </View>

      <Text
        style={styles.distance}
        accessibilityRole="text"
        accessibilityLabel={`${formatDistance(distanceM)} to ${target.label}, straight-line distance`}
      >
        <DisplayWords text={formatDistance(distanceM)} fontSize={styles.distance.fontSize} />
      </Text>
      {eta != null ? <Text style={styles.honest}>{`~${eta} min walk`}</Text> : null}
      {calibrate ? (
        <Text style={styles.calibrate} accessibilityRole="alert">
          Move your phone in a figure 8 to calibrate the compass.
        </Text>
      ) : null}
      <Text style={styles.honest}>Straight-line direction to a point you saved. Works without signal.</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    alignItems: 'center',
    gap: t.spacing[4],
    paddingVertical: t.spacing[6],
    paddingHorizontal: t.spacing[5],
  },
  label: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  dial: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  distance: {
    ...typeStyle('display-lg', 700),
    color: t.colors.text.primary,
  },
  honest: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  calibrate: {
    ...typeStyle('caption'),
    color: t.colors.accent.amber,
    textAlign: 'center',
  },
  stateCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[3],
    paddingVertical: t.spacing[6],
    paddingHorizontal: t.spacing[5],
  },
  stateTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  stateBody: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
}));
