// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * compass.tsx — M5 proximity-compass route (mobile-only, NEW route).
 *
 * Resolves a target and hands it to <MeetingPointCompass />.
 * Target source, in order:
 *   1. Explicit route params (?label=&latitude=&longitude=) — e.g. deep link
 *      or a "navigate here" tap on a specific point.
 *   2. ?peer= — a crewmate sharing live location now.
 *   3. ?mpId= — look up that meeting point in the persisted crewStore.
 *   4. Fall back to the first compassTargets entry: the soonest active meeting
 *      point with coords, then live crewmates.
 *
 * The compass itself is on-device + offline-honest. Only the optional
 * "Looking for you" button (PeerNudge) uses the network.
 */
import { useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useCrewStore, useLiveLocationStore } from '@festie/shared/stores';
import { FIND_FRIEND_COPY, LIVE_LOCATION } from '@festie/shared/constants';
import {
  compassTargets,
  crewMemberName,
  formatStaleness,
  getInitials,
  isPeerStale,
  type CompassTarget,
} from '@festie/shared/utils';
import { spacing } from '@festie/shared/tokens';
import { makeStyles, typeStyle, useTokens, iconSize } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { useNow } from '../hooks/useNow';
import EmptyState from '../components/EmptyState';
import AppPressable from '../components/AppPressable';
import PeerNudge from '../components/PeerNudge';
import MeetingPointCompass, { type MeetingPointTarget } from '../components/MeetingPointCompass';

/** Parse a route param that may be string | string[] | undefined into a finite number. */
function paramNumber(v: string | string[] | undefined): number {
  const s = Array.isArray(v) ? v[0] : v;
  if (s == null) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function paramString(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s != null && s.length > 0 ? s : undefined;
}

function hasCoords(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);
}

export default function CompassScreen() {
  const styles = useStyles();
  const t = useTokens();
  const bottomPad = useListBottomInset({ base: spacing[4] });
  const params = useLocalSearchParams<{
    label?: string;
    latitude?: string;
    longitude?: string;
    mpId?: string;
    peer?: string;
  }>();
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const peers = useLiveLocationStore((s) => s.peers);
  const liveCrewId = useLiveLocationStore((s) => s.crewId);
  const selfId = useAuthStore((s) => s.user?.id ?? null);
  const now = useNow();
  // The last username seen for a peer while live, so the gone card can still name them.
  const lastNames = useRef<Record<string, string>>({});

  const targets = useMemo(
    () => compassTargets({ meetingPoints, peers, selfUserId: selfId, nowMs: now }),
    [meetingPoints, peers, selfId, now],
  );

  const peerParam = paramString(params.peer);
  const mpId = paramString(params.mpId);
  const explicitLat = paramNumber(params.latitude);
  const explicitLng = paramNumber(params.longitude);
  const hasExplicit = Number.isFinite(explicitLat) && Number.isFinite(explicitLng);
  const mp = mpId ? meetingPoints.find((p) => p.id === mpId && hasCoords(p.latitude, p.longitude)) : undefined;
  // No param resolves a target and the first fallback is a crewmate: treat it as ?peer= so the
  // screen keeps the peer note, age line, nudge and gone card (the Map tab button opens bare /compass).
  const fallbackPeerId =
    !hasExplicit && !peerParam && !mp && targets[0]?.kind === 'peer' ? targets[0].id : undefined;
  const peerId = peerParam ?? fallbackPeerId;
  const usePeer = !hasExplicit && peerId != null;
  // Pin the fallback peer in the route so the gone card shows once they stop sharing.
  // Not while an ?mpId= is set: that meeting point may resolve once the crew store hydrates.
  useEffect(() => {
    if (fallbackPeerId && !mpId) router.setParams({ peer: fallbackPeerId });
  }, [fallbackPeerId, mpId]);

  const peer = peerId ? peers[peerId] : undefined;
  const peerLive =
    usePeer &&
    peer != null &&
    hasCoords(peer.lat, peer.lng) &&
    !isPeerStale(peer.serverAt, now, LIVE_LOCATION.STALE_MS);
  if (peerId && peerLive && peer?.username) lastNames.current[peerId] = peer.username;
  // crewMemberName falls back to 'Someone', so only call it for a member we found.
  const member = peerId ? crewMembers.find((m) => m.userId === peerId) : undefined;
  const memberName = member ? crewMemberName(member) : '';
  const name = peerId ? (memberName || lastNames.current[peerId] || 'your crewmate') : '';

  const target: MeetingPointTarget | null = useMemo(() => {
    if (hasExplicit) {
      return { label: paramString(params.label) ?? 'Meeting point', latitude: explicitLat, longitude: explicitLng };
    }
    if (usePeer) {
      return peerLive && peer ? { label: name, latitude: peer.lat, longitude: peer.lng } : null;
    }
    if (mp) {
      return { label: mp.label, latitude: mp.latitude as number, longitude: mp.longitude as number };
    }
    const first = targets[0];
    return first ? { label: first.label, latitude: first.latitude, longitude: first.longitude } : null;
  }, [hasExplicit, explicitLat, explicitLng, params.label, usePeer, peerLive, peer, name, mp, targets]);

  const peerGone = usePeer && !peerLive;
  const showChips = targets.length >= 2 || (peerGone && targets.length >= 1);
  const selectedKey = usePeer ? `peer:${peerId}` : mp ? `mp:${mp.id}` : hasExplicit ? undefined : targets[0]?.key;
  const pick = (c: CompassTarget) =>
    router.setParams({
      peer: c.kind === 'peer' ? c.id : undefined,
      mpId: c.kind === 'meeting-point' ? c.id : undefined,
      label: undefined,
      latitude: undefined,
      longitude: undefined,
    });

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Compass', headerShown: true }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
        {showChips ? (
          <View style={styles.chipBlock}>
            <Text style={styles.chipHeading}>{FIND_FRIEND_COPY.pointTo}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {targets.map((c) => {
                const selected = c.key === selectedKey;
                return (
                  <AppPressable
                    key={c.key}
                    style={[styles.chip, selected && styles.chipSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={FIND_FRIEND_COPY.pointToA11y(c.label)}
                    onPress={() => pick(c)}
                  >
                    {c.kind === 'peer' ? (
                      <View style={styles.dot}>
                        <Text style={styles.dotText}>{getInitials(c.label)}</Text>
                      </View>
                    ) : (
                      <Ionicons name="location-outline" size={iconSize.md} color={t.colors.text.secondary} />
                    )}
                    <Text style={styles.chipLabel} numberOfLines={1}>
                      {c.label}
                    </Text>
                  </AppPressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
        {target ? (
          <MeetingPointCompass
            target={target}
            note={usePeer ? FIND_FRIEND_COPY.peerNote(name) : hasExplicit ? FIND_FRIEND_COPY.explicitNote : undefined}
            subNote={usePeer && peer ? FIND_FRIEND_COPY.peerAge(formatStaleness(peer.serverAt)) : undefined}
          />
        ) : peerGone ? (
          <EmptyState
            icon="person-outline"
            title={FIND_FRIEND_COPY.peerGoneTitle(name)}
            message={FIND_FRIEND_COPY.peerGoneBody}
          />
        ) : (
          <EmptyState
            icon="navigate-outline"
            title={FIND_FRIEND_COPY.emptyTitle}
            message={FIND_FRIEND_COPY.emptyBody}
            action={{
              label: 'Set a meeting point',
              onPress: () => router.push({ pathname: '/(tabs)/crew', params: { tab: 'find' } }),
            }}
          />
        )}
        {usePeer && peerId ? (
          <PeerNudge crewId={peer?.crewId ?? liveCrewId ?? activeCrew?.id ?? null} userId={peerId} name={name} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  content: {
    flexGrow: 1,
    padding: t.spacing[4],
    gap: t.spacing[4],
  },
  chipBlock: {
    gap: t.spacing[2],
  },
  chipHeading: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  chipRow: {
    gap: t.spacing[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 44,
    maxWidth: 220,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  chipSelected: {
    borderColor: t.colors.accent.aqua,
  },
  chipLabel: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.elevated,
  },
  dotText: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
}));
