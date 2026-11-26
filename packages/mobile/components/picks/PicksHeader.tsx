import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COPY } from '@festie/shared/constants';
import { useTokens, useLargeText, MAX_FONT_SCALE } from '../../hooks/useTokens';
import GuestPicksBanner from '../GuestPicksBanner';
import CrewSuggestionStrip from '../CrewSuggestionStrip';
import RateNightBanner from '../RateNightBanner';
import LockscreenStaleBanner from '../LockscreenStaleBanner';
import OfflineReadinessCard from '../OfflineReadinessCard';
import ClashCards from '../ClashCards';
import MarkedNoSet from '../MarkedNoSet';
import type { Dispatch, ReactElement, SetStateAction } from 'react';
import { useStyles } from './styles';
import type { Festival, User } from '@festie/shared/types';
import type { ConflictGroup } from '@festie/shared/utils';

interface PicksHeaderProps {
  bulkPanel: ReactElement | null;
  calendarButton: ReactElement;
  conflictGroups: ConflictGroup[];
  controlsRow: ReactElement | null;
  currentFestival: Festival | null;
  days: { index: number; date: string; label?: string; }[];
  handleSharePicks: () => void;
  listenSection: ReactElement | null;
  noPicks: boolean;
  orderRow: ReactElement | null;
  searchField: ReactElement | null;
  setClashY: Dispatch<SetStateAction<number | null>>;
  summaryRow: ReactElement | null;
  user: User | null;
}

export default function PicksHeader({
  bulkPanel,
  calendarButton,
  conflictGroups,
  controlsRow,
  currentFestival,
  days,
  handleSharePicks,
  listenSection,
  noPicks,
  orderRow,
  searchField,
  setClashY,
  summaryRow,
  user,
}: PicksHeaderProps) {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  const largeText = useLargeText();
  return (
<View>
  {!user ? <GuestPicksBanner /> : null}
  <View style={[styles.headerActions, largeText && styles.headerActionsLarge]}>
    {calendarButton}
    <TouchableOpacity
      style={[styles.calendarButton, largeText && styles.calendarButtonLarge, noPicks && styles.calendarButtonDisabled]}
      onPress={() => router.push('/picks-image')}
      disabled={noPicks}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ disabled: noPicks }}
      accessibilityLabel="Save my picks as an image"
    >
      <Ionicons name="image-outline" size={t.iconSize.sm} color={t.colors.accent.aqua} />
      <Text style={styles.calendarButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
        {COPY.picks.saveImage}
      </Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.calendarButton, largeText && styles.calendarButtonLarge, !currentFestival && styles.calendarButtonDisabled]}
      onPress={handleSharePicks}
      disabled={!currentFestival}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ disabled: !currentFestival }}
      accessibilityLabel="Share my picks"
    >
      <Ionicons name="share-outline" size={t.iconSize.sm} color={t.colors.accent.aqua} />
      <Text style={styles.calendarButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
        {COPY.picks.share}
      </Text>
    </TouchableOpacity>
  </View>
  {currentFestival && (
    <View style={styles.offlineCard}>
      <OfflineReadinessCard festivalId={currentFestival.id} />
    </View>
  )}
  {summaryRow}
  {controlsRow}
  {orderRow}
  {searchField}
  <CrewSuggestionStrip />
  <LockscreenStaleBanner />
  <RateNightBanner />
  <MarkedNoSet />
  <View onLayout={(e) => setClashY(e.nativeEvent.layout.y)}>
    <ClashCards groups={conflictGroups} days={days} />
  </View>
  {bulkPanel}
  {listenSection}
</View>
  );
}
