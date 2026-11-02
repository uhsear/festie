// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import {
  encodePlanSnapshot,
  buildPlanSnapshotInput,
  buildPlanQrUrl,
  MAX_ENCODED_LENGTH,
} from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import type { CrewMeetingPoint, Priority } from '@festie/shared/types';
import { makeStyles, typeStyle } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { useNow } from '../hooks/useNow';
import EmptyState from './EmptyState';

// ── Snapshot assembly (offline-native, zero network) ───────────────────────
// Builds the compact P2P snapshot ENTIRELY from the persisted stores already in
// memory — currentFestival + currentProfile.picks (festivalDataStore) and the
// active meeting point (crewStore). No fetches: this works on a dead-signal
// device. Picks are priority-ranked (must > want > maybe) and capped to MAX_PICKS
// so an over-long plan still produces a single scannable code; the codec also
// truncates defensively.

/**
 * Renders a QR code of the encoded plan snapshot. A nearby crew member scans it
 * (PlanQRScan) to import the plan onto their own device with NO internet on
 * either phone.
 */
export default function PlanQRShare() {
  const styles = useStyles();
  const bottomPad = useListBottomInset();

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  // Ticks so the "active now" share meeting point stays current without an
  // impure Date.now() in the memo factory (react-hooks/purity).
  const now = useNow();

  const { encoded, picksCount, meetingPoint, tooLong } = useMemo(() => {
    if (!currentFestival || !currentProfile) {
      return {
        encoded: null as string | null,
        picksCount: 0,
        meetingPoint: null as CrewMeetingPoint | null,
        tooLong: false,
      };
    }

    const { input, picksCount, meetingPoint: mp } = buildPlanSnapshotInput({
      festival: currentFestival,
      picks: currentProfile.picks as Record<string, Priority> | undefined,
      meetingPoints,
      nowMs: now,
    });

    const enc = encodePlanSnapshot(input);
    return {
      encoded: enc,
      picksCount,
      meetingPoint: mp,
      tooLong: enc.length > MAX_ENCODED_LENGTH,
    };
  }, [currentFestival, currentProfile, meetingPoints, now]);

  if (!currentFestival || !currentProfile) {
    return (
      <EmptyState
        icon="qr-code-outline"
        title="No plan to share yet"
        message="Open a festival and add a few picks, then come back to share them."
      />
    );
  }

  // Defensive: the codec is size-bounded, but if a plan somehow exceeds the
  // scannable limit, say so honestly rather than render an unscannable code.
  if (!encoded || tooLong) {
    return (
      <EmptyState
        icon="warning-outline"
        title="Plan too big for one code"
        message="Trim a few picks and try again — a QR code can only hold so much."
      />
    );
  }

  if (picksCount === 0 && !meetingPoint) {
    return (
      <EmptyState
        icon="qr-code-outline"
        title="No picks to share yet"
        message="Add a few picks, then come back to share your plan."
        action={{ label: 'Browse lineup', onPress: () => router.navigate('/(tabs)') }}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
      <Text style={styles.heading}>{currentFestival.name}</Text>
      <Text style={styles.sub}>
        {picksCount} pick{picksCount === 1 ? '' : 's'}
        {meetingPoint ? ` · meet at ${meetingPoint.label}` : ''}
      </Text>

      <View
        style={styles.qrCard}
        accessible
        accessibilityLabel="QR code that opens your picks in a browser"
      >
        <QRCode
          value={buildPlanQrUrl(encoded)}
          size={240}
          // High-contrast on a light tile so cameras lock fast in low festival light.
          color="#080810"
          backgroundColor="#FFFFFF"
          // L error correction keeps the code small/dense-free for our bounded payload.
          ecl="M"
        />
      </View>

      <Text style={styles.instructions}>Point any phone camera here to open these picks in a browser.</Text>
      <Text style={styles.instructions}>
        Friends with Festie can scan it in {COPY.picks.share} › Scan QR, then choose which picks to add. Works offline —
        nothing is sent over the internet. It's a snapshot, not a live link.
      </Text>
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  content: {
    padding: t.spacing[4],
    gap: t.spacing[3],
    alignItems: 'center',
  },
  heading: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  sub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    padding: t.spacing[4],
    borderRadius: t.radii.default,
  },
  instructions: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
}));
