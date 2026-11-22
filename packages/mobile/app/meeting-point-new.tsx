// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useMemo, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore, useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import { useActiveCrew } from '@festie/shared/hooks';
import { isCrewOwner } from '@festie/shared/utils';
import { COPY, signInTo } from '@festie/shared/constants';
import CrewMeetingPoints from '../components/CrewMeetingPoints';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
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
  const { status, crew: activeCrew, retry: retryCrew } = useActiveCrew();
  const crewMembers = useCrewStore((s) => s.crewMembers);
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

  // The crew store may still be hydrating on a cold deep link, so wait for it before deciding the screen is empty.
  const gate = (children: ReactNode) => <View style={styles.screen}>{children}</View>;
  if (!user) {
    return gate(
      <EmptyState
        icon="lock-closed"
        title={COPY.auth.signInRequired}
        message={signInTo('add a meeting point')}
        action={{ label: COPY.auth.signIn, onPress: () => router.push('/(auth)/login') }}
      />,
    );
  }
  if (status === 'loading') return gate(<LoadingState label="Loading your crew…" />);
  if (status === 'error') {
    return gate(
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn't load your crew"
        message="Check your connection, then try again."
        action={{ label: 'Try again', onPress: retryCrew }}
      />,
    );
  }
  if (status === 'joining') {
    return gate(
      <EmptyState
        icon="cloud-offline-outline"
        title="Joining when you're back online"
        message="Your join is saved on this device. The crew opens once you reconnect."
      />,
    );
  }
  if (status === 'none' || !activeCrew) {
    return gate(
      <EmptyState
        icon="people-outline"
        title="No crew yet"
        message="Make a crew or join one with a code to add a meeting point."
        action={{ label: 'Create or join a crew', onPress: () => router.navigate('/(tabs)/crew') }}
      />,
    );
  }

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
        isOwner={isCrewOwner(activeCrew, crewMembers.length ? crewMembers : (activeCrew.members ?? []), user.id)}
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
