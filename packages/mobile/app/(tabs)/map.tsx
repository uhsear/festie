import { useCallback, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { useAuthStore, useCrewStore, useLiveLocationStore, useFestivalDataStore } from '@festie/shared/stores';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useHaptics } from '../../hooks/useHaptics';
import { useSosRaise } from '../../hooks/useSosRaise';
import { CREW_MEET_HREF } from '../../lib/dayOfRoutes';
import OfflineMap from '../../components/OfflineMap';
import FreshnessChip from '../../components/FreshnessChip';
import EmptyState from '../../components/EmptyState';
import ScreenHeader from '../../components/ScreenHeader';
import { LowPowerIndicator } from '../../components/LowPowerControls';

/** Sweep stale peers off the map on this cadence while the screen is mounted. */
const SWEEP_INTERVAL_MS = 15_000;
/** Mirrors IOS_NATIVE_TAB_BAR_HEIGHT in (tabs)/index.tsx: the native iOS tab bar overlays content. */
const IOS_NATIVE_TAB_BAR_HEIGHT = 49;

/** A meeting point is navigable by the compass only if it carries finite coords. */
function hasCoords(mp: CrewMeetingPoint): boolean {
  return (
    typeof mp.latitude === 'number' &&
    typeof mp.longitude === 'number' &&
    Number.isFinite(mp.latitude) &&
    Number.isFinite(mp.longitude)
  );
}

/**
 * Map tab — M6 offline map for the current festival.
 *
 * Everyone sees stages and amenities. Crew layers (meeting points, live
 * friends, SOS and tap-to-create) show only for a signed-in user with a crew.
 *
 * Renders meeting-point pins (F4 coords) over a WebView-hosted MapLibre map, with
 * a graceful offline fallback list when the map can't load (see OfflineMap). All
 * data comes from the persisted crewStore — no fetch — so it works on a cold
 * offline launch. Honest copy throughout: the map is an online enhancement; the
 * pinned-points list is the offline path until the festival is downloaded (F5).
 */
export default function MapScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();

  const user = useAuthStore((s) => s.user);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const meetingPoints = useCrewStore((s) => s.meetingPoints) as CrewMeetingPoint[];

  // Festival map data: currentFestival carries `mapConfig` (amenities + camera);
  // stages live as a separate top-level array in the store. Fold them together so
  // OfflineMap can plot stage + amenity pins. Null when no festival is selected —
  // OfflineMap keeps its meeting-points-only behaviour + "not mapped yet" note.
  // Read from festivalDataStore — the SAME store selectFestival writes (and the
  // schedule reads). map.tsx previously read useFestivalStore.currentFestival,
  // a different store that selection never updates, so the map showed a stale/
  // wrong festival (e.g. it kept FK 2K26 after switching to another festival).
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const festivalStages = useFestivalDataStore((s) => s.stages);
  const mapFestival = useMemo(
    () => (currentFestival ? { ...currentFestival, stages: festivalStages } : null),
    [currentFestival, festivalStages],
  );

  // Ephemeral live location + SOS (never persisted). The record is a stable ref
  // unless it changes, so derive the array via memo to avoid render churn.
  const peersRecord = useLiveLocationStore((s) => s.peers);
  const activeSosList = useLiveLocationStore((s) => s.activeSosList);
  const sweepStale = useLiveLocationStore((s) => s.sweepStale);
  const setActiveCrew = useLiveLocationStore((s) => s.setActiveCrew);
  const peers = useMemo(() => Object.values(peersRecord), [peersRecord]);

  // R24: pulsing coral ring on SOS FAB while an active SOS exists for this crew.
  // Continuous animation justified (emergency context). Reduce-motion: static ring.
  const crewSosList = useMemo(
    () => activeSosList.filter((e) => e.crewId === activeCrew?.id),
    [activeSosList, activeCrew?.id],
  );
  const { confirmRaise } = useSosRaise(activeCrew?.id ?? null);
  const reduceMotion = useReduceMotion();
  const sosFabGlow = useSharedValue(0);
  const sosActive = crewSosList.length > 0;
  const mySosActive = crewSosList.some((e) => e.userId === user?.id);
  useEffect(() => {
    if (!sosActive || reduceMotion) {
      sosFabGlow.value = 0;
      return;
    }
    sosFabGlow.value = withRepeat(withTiming(1, { duration: 750, easing: Easing.out(Easing.cubic) }), -1, true);
  }, [sosActive, reduceMotion, sosFabGlow]);
  // Cross-platform pulse: an actual coral ring View whose opacity/scale animate
  // (works on Android, unlike shadow* which is iOS-only). Reduce-motion: static
  // ring at a fixed mid value, no animation.
  const sosRingStyle = useAnimatedStyle(() => {
    const v = reduceMotion ? 0.5 : sosFabGlow.value;
    return {
      opacity: 0.15 + v * 0.35,
      transform: [{ scale: 1 + v * 0.18 }],
    };
  });

  // Scope the live store to this crew on mount/crew change.
  useEffect(() => {
    setActiveCrew(activeCrew?.id ?? null);
  }, [activeCrew?.id, setActiveCrew]);

  // Self-heal: drop peers older than the TTL even if a peer-stopped never arrives.
  useEffect(() => {
    const id = setInterval(() => sweepStale(Date.now()), SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sweepStale]);

  // Tap-to-create: a long-press on the map deep-links into the crew Find
  // tab with the pressed coords, where CrewMeetingPoints opens its create form
  // prefilled with them. No write happens here — the user still confirms "Add".
  const handleMapPress = useCallback((coord: { latitude: number; longitude: number }) => {
    router.push({
      pathname: '/(tabs)/crew',
      params: {
        tab: 'find',
        mpLat: String(coord.latitude),
        mpLng: String(coord.longitude),
      },
    });
  }, []);

  const crewLayers = Boolean(user && activeCrew);
  const hasCompassPoint = crewLayers && (meetingPoints ?? []).some((p) => p && p.active !== false && hasCoords(p));
  const compassButton = hasCompassPoint ? (
    <TouchableOpacity
      testID="map-compass"
      style={styles.compassButton}
      onPress={() => router.push('/compass')}
      accessibilityRole="button"
      accessibilityLabel="Open the meeting-point compass"
    >
      <Ionicons name="navigate-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
    </TouchableOpacity>
  ) : undefined;

  if (!mapFestival) {
    return (
      <View testID="map-screen" style={styles.screen}>
        <ScreenHeader title="Map" subtitle={activeCrew?.name} icon="map-outline" right={compassButton} />
        <EmptyState
          icon="map-outline"
          title="No festival selected"
          message="Pick a festival on the Lineup tab to see its map."
        />
      </View>
    );
  }

  return (
    <View testID="map-screen" style={styles.screen}>
      <ScreenHeader title="Map" subtitle={activeCrew?.name} icon="map-outline" right={compassButton} />
      <View style={styles.chipBar}>
        <FreshnessChip surface="crew" />
        {/* Surfaces the shared low-power flag on the map so battery-saving GPS
            degradation (see OfflineMap's watchPositionAsync) is visible, not silent. */}
        <LowPowerIndicator />
      </View>
      {!crewLayers ? (
        <Text style={styles.crewHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {user
            ? 'Join a crew to see friends and meeting points here.'
            : 'Sign in and join a crew to see friends and meeting points here.'}
        </Text>
      ) : null}
      <OfflineMap
        meetingPoints={crewLayers ? meetingPoints : []}
        peers={crewLayers ? peers : []}
        activeSosList={crewLayers ? crewSosList : []}
        onMapPress={crewLayers ? handleMapPress : undefined}
        festival={mapFestival}
        bottomInset={Platform.OS === 'ios' ? IOS_NATIVE_TAB_BAR_HEIGHT : 0}
      />

      {/* DC2 + R24: raise-SOS shortcut on the map. The FAB lives in an outer
          absolutely-positioned wrapper so its placement never depends on the
          parent's flex flow — an absolute child of a relative-flow parent
          collapses to 0x0 on Android New Arch. Pulsing coral RING (a real View,
          not shadow*) while an active SOS exists for this crew; reduce-motion
          shows a static ring. */}
      {crewLayers ? (
        <View
          style={[
            styles.sosFabWrap,
            { bottom: (Platform.OS === 'ios' ? IOS_NATIVE_TAB_BAR_HEIGHT + insets.bottom : 0) + t.spacing[5] },
          ]}
          pointerEvents="box-none"
        >
          {sosActive ? <Animated.View pointerEvents="none" style={[styles.sosRing, sosRingStyle]} /> : null}
          <TouchableOpacity
            testID="map-sos-fab"
            style={styles.sosFab}
            onPress={() => {
              haptics.tap();
              // Own SOS already up: open the crew tab so they can tap "I'm safe".
              if (mySosActive) router.push(CREW_MEET_HREF);
              else confirmRaise();
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Send an SOS to your crew"
            accessibilityHint="Asks for confirmation before sending"
          >
            <Ionicons name="alert-circle" size={20} color={t.colors.text.onAccent} />
            <Text style={styles.sosFabText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              SOS
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  chipBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
  },
  crewHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[2],
  },
  compassButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Outer wrapper is the only absolutely-positioned node — pins the FAB to the
  // bottom-right regardless of parent flow so it reliably renders on Android.
  sosFabWrap: {
    position: 'absolute',
    right: t.spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Coral pulse ring behind the FAB. Centered absolutely on the wrapper and
  // sized to overhang the pill; animated opacity/scale carry the pulse.
  sosRing: {
    position: 'absolute',
    top: -8,
    bottom: -8,
    left: -8,
    right: -8,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.coralStrong,
  },
  sosFab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 52,
    paddingHorizontal: t.spacing[4],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.coralStrong,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  sosFabText: {
    ...typeStyle('label', 700),
    color: t.colors.text.onAccent,
  },
}));
