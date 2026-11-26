import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFestivalStore, useFestivalModeStore } from '@festie/shared/stores';
import { LOW_POWER_COPY } from '@festie/shared/constants';
import type { Crew, Festival, User } from '@festie/shared/types';
import { useTokens } from '../../hooks/useTokens';
import Button from '../Button';
import SectionLabel from '../SectionLabel';
import CrewHomeBase from '../CrewHomeBase';
import CrewPhotoLink from '../CrewPhotoLink';
import CrewMeetingPoints from '../CrewMeetingPoints';
import CrewStatus from '../CrewStatus';
import CrewActivity from '../CrewActivity';
import CrewLiveLocation from '../CrewLiveLocation';
import CrewSos from '../CrewSos';
import CrewCheckIn from '../CrewCheckIn';
import { BeaconRow } from '../BeaconModal';
import { LowPowerIndicator } from '../LowPowerControls';
import type { ReactElement, ReactNode } from 'react';
import { useStyles } from './styles';

interface CrewFindTabProps {
  crew: Crew;
  crewFestival: Festival | null | undefined;
  crewRefreshControl: ReactElement;
  festivalDays: ReturnType<typeof useFestivalStore.getState>['days'];
  inviteCard: ReactNode;
  isOwner: boolean;
  lowPowerMode: boolean;
  tabBodyStyle: StyleProp<ViewStyle>;
  tabScrollStyle: StyleProp<ViewStyle>;
  user: User;
}

export default function CrewFindTab({
  crew,
  crewFestival,
  crewRefreshControl,
  festivalDays,
  inviteCard,
  isOwner,
  lowPowerMode,
  tabBodyStyle,
  tabScrollStyle,
  user,
}: CrewFindTabProps) {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  return (
    <ScrollView
      style={tabBodyStyle}
      contentContainerStyle={tabScrollStyle}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={crewRefreshControl}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      {/* DC2: SOS must be reachable without any scroll — top of the pane,
          always visible the instant the Find tab opens. */}
      <CrewSos crewId={crew.id} currentUserId={user.id} />
      {inviteCard}
      <CrewCheckIn crewId={crew.id} />

      <TouchableOpacity
        testID="crew-action-map"
        style={styles.overlapToggle}
        onPress={() => router.navigate('/(tabs)/map')}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Open the map with your crew and meeting points"
      >
        <Ionicons name="map-outline" size={t.iconSize.sm} color={t.colors.accent.aqua} />
        <Text style={styles.overlapToggleText}>Open map</Text>
        <Ionicons name="chevron-forward" size={t.iconSize.sm} color={t.colors.accent.aqua} />
      </TouchableOpacity>

      <SectionLabel>Meeting points</SectionLabel>
      <CrewHomeBase crewId={crew.id} location={crew.homeBaseLocation} time={crew.homeBaseTime} isOwner={isOwner} />
      <CrewMeetingPoints
        crewId={crew.id}
        currentUserId={user.id}
        isOwner={isOwner}
        festival={crewFestival}
        days={crewFestival ? festivalDays : undefined}
      />

      {/* In low-power mode the battery-hungry live-location share is paused
          (gated by the shared festival low-power flag); a chip explains why. */}
      <CrewStatus crewId={crew.id} currentUserId={user.id} />

      <SectionLabel>Live location</SectionLabel>
      <View style={styles.liveSafetyBlock}>
        {lowPowerMode ? (
          <View style={styles.lowPowerPaused}>
            <LowPowerIndicator />
            <Text style={styles.lowPowerPausedText}>{LOW_POWER_COPY.livePaused}</Text>
            <Button
              variant="secondary"
              label={LOW_POWER_COPY.turnOff}
              onPress={() => useFestivalModeStore.getState().setLowPowerMode(false)}
            />
          </View>
        ) : (
          <CrewLiveLocation crewId={crew.id} />
        )}
      </View>
      <BeaconRow />

      <CrewPhotoLink crewId={crew.id} photoAlbumUrl={crew.photoAlbumUrl} />

      <SectionLabel>Activity</SectionLabel>
      <CrewActivity crewId={crew.id} />
    </ScrollView>
  );
}
