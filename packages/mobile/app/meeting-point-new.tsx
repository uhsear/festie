// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useMemo } from 'react';
import { ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore, useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import CrewMeetingPoints from '../components/CrewMeetingPoints';
import { makeStyles, useTokens } from '../hooks/useTokens';

function finiteOrNull(value: string | undefined): number | null {
  const n = value != null ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Meeting-point create sheet, opened over the map with the tapped coordinates.
 * The map stays mounted behind the sheet; saving or cancelling just goes back.
 */
export default function MeetingPointNewScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const { lat, lng, label, location, stageReference } = useLocalSearchParams<{
    lat?: string;
    lng?: string;
    label?: string;
    location?: string;
    stageReference?: string;
  }>();
  const user = useAuthStore((s) => s.user);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const days = useFestivalDataStore((s) => s.days);

  const coords = useMemo(() => {
    const la = finiteOrNull(lat);
    const lo = finiteOrNull(lng);
    if (la === null || lo === null) return null;
    // A deep link can carry any text: clamp to the meetingPointCreateSchema lengths.
    return {
      lat: la,
      lng: lo,
      label: label?.slice(0, 100),
      location: location?.slice(0, 200),
      stageReference: stageReference?.slice(0, 100),
    };
  }, [lat, lng, label, location, stageReference]);

  const missing = !user || !activeCrew;
  useEffect(() => {
    if (missing) router.back();
  }, [missing, router]);

  if (!user || !activeCrew) return null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: t.spacing[4] }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <CrewMeetingPoints
        crewId={activeCrew.id}
        currentUserId={user.id}
        isOwner={false}
        festival={festival}
        days={days}
        prefillCoords={coords}
        formOnly
        onDone={() => router.back()}
      />
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
}));
