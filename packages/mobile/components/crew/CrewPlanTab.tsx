import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCrew } from '@festie/shared/hooks';
import { COPY } from '@festie/shared/constants';
import { setLabel } from '@festie/shared/utils';
import type { Crew, CrewOverlap, FestivalSet, User } from '@festie/shared/types';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import SectionLabel from '../SectionLabel';
import CrewPolls from '../CrewPolls';
import CrewPacking from '../CrewPacking';
import CrewRides from '../CrewRides';
import { useRef, type ReactElement, type ReactNode } from 'react';
import { useStyles } from './styles';

interface CrewPlanTabProps {
  crew: Crew;
  crewRefreshControl: ReactElement;
  handleToggleOverlap: (crewId: string) => Promise<void>;
  inviteCard: ReactNode;
  isOwner: boolean;
  openPollCount: number;
  overlapBusy: boolean;
  overlapEntries: CrewOverlap[];
  overlapError: string | null;
  packingDone: boolean;
  packingLeft: number;
  rideCount: number;
  setsById: Map<string, FestivalSet>;
  showOverlap: boolean;
  tabBodyStyle: StyleProp<ViewStyle>;
  tabScrollStyle: StyleProp<ViewStyle>;
  user: User;
}

export default function CrewPlanTab({
  crew,
  crewRefreshControl,
  handleToggleOverlap,
  inviteCard,
  isOwner,
  openPollCount,
  overlapBusy,
  overlapEntries,
  overlapError,
  packingDone,
  packingLeft,
  rideCount,
  setsById,
  showOverlap,
  tabBodyStyle,
  tabScrollStyle,
  user,
}: CrewPlanTabProps) {
  const styles = useStyles();
  const t = useTokens();
  // Plan index: each chip scrolls its section label to the top of the Plan pane.
  const reduceMotion = useReduceMotion();
  const planScrollRef = useRef<ScrollViewInstance>(null);
  const planSectionY = useRef<{ polls?: number; packing?: number; rides?: number }>({});
  const planIndex = [
    { key: 'polls', testID: 'plan-index-polls', label: 'Polls', count: openPollCount },
    { key: 'packing', testID: 'plan-index-packing', label: 'Packing', count: packingLeft },
    { key: 'rides', testID: 'plan-index-rides', label: 'Rides', count: rideCount },
  ] as const;
  const jumpToPlanSection = (key: 'polls' | 'packing' | 'rides') =>
    planScrollRef.current?.scrollTo({
      y: Math.max(0, (planSectionY.current[key] ?? 0) - t.spacing[2]),
      animated: !reduceMotion,
    });
  const router = useRouter();
  // Per-set crew picks (shared hook) — used to enrich the overlap UI without
  // an extra endpoint round-trip.
  const { getCrewScopedOtherPicks } = useCrew();
  return (
    <ScrollView
      ref={planScrollRef}
      style={tabBodyStyle}
      contentContainerStyle={tabScrollStyle}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={crewRefreshControl}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      {inviteCard}
      <View style={styles.planIndexRow}>
        {planIndex.map(({ key, testID, label, count }) => (
          <TouchableOpacity
            key={key}
            testID={testID}
            style={styles.planIndexChip}
            onPress={() => jumpToPlanSection(key)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Jump to ${label}`}
          >
            <Text style={styles.overlapToggleText} numberOfLines={1}>{label}</Text>
            {count > 0 ? (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{count}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      {/* Everyday primary: the offline-native "what's my crew's plan"
          digest. Emphasized (aqua-tinted fill + border) so the most-used
          action carries more weight than the rest of the tab. Coral is
          reserved for danger/SOS, so these nav actions are aqua. */}
      <TouchableOpacity
        testID="crew-action-plan"
        style={[styles.overlapToggle, styles.overlapTogglePrimary]}
        onPress={() => router.push('/crew-plan')}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="View your crew's plan"
      >
        <Ionicons name="calendar-outline" size={t.iconSize.sm} color={t.colors.accent.aqua} />
        <Text style={styles.overlapTogglePrimaryText}>Crew plan</Text>
        <Ionicons name="chevron-forward" size={t.iconSize.sm} color={t.colors.accent.aqua} />
      </TouchableOpacity>

      {/* Schedule compare / overlap toggle. */}
      <TouchableOpacity
        testID="crew-action-overlap"
        style={styles.overlapToggle}
        onPress={() => handleToggleOverlap(crew.id)}
        disabled={overlapBusy}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={showOverlap ? 'Hide schedule overlap' : 'Compare crew schedules'}
      >
        <Ionicons name="git-compare-outline" size={t.iconSize.sm} color={t.colors.accent.aqua} />
        <Text style={styles.overlapToggleText}>
          {overlapBusy ? 'Loading overlap…' : showOverlap ? 'Hide schedule overlap' : 'Compare schedules'}
        </Text>
        {overlapBusy ? (
          <ActivityIndicator size="small" color={t.colors.accent.aqua} />
        ) : (
          <Ionicons name={showOverlap ? 'chevron-up' : 'chevron-down'} size={t.iconSize.sm} color={t.colors.accent.aqua} />
        )}
      </TouchableOpacity>

      {overlapError ? (
        <TouchableOpacity
          style={styles.overlapErrorRow}
          onPress={() => handleToggleOverlap(crew.id)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading schedule overlap"
        >
          <Ionicons name="cloud-offline-outline" size={t.iconSize.sm} color={t.colors.text.danger} />
          <Text style={styles.overlapErrorText}>{overlapError}</Text>
          <Text style={styles.overlapRetryText}>Retry</Text>
        </TouchableOpacity>
      ) : null}

      {showOverlap ? (
        overlapEntries.length === 0 ? (
          <Text style={styles.overlapEmpty}>No shared picks yet — overlap appears once members add sets.</Text>
        ) : (
          <View style={styles.overlapList}>
            {overlapEntries.map((o) => {
              const picks = getCrewScopedOtherPicks(o.setId);
              const mustCount = picks.filter((p) => p.priority === 'must').length;
              return (
                <View key={o.setId} style={styles.overlapRow}>
                  <View style={styles.overlapInfo}>
                    <Text style={styles.overlapSet} numberOfLines={2}>
                      {setLabel(setsById.get(o.setId), o.setId)}
                    </Text>
                    <Text style={styles.overlapMeta}>
                      {o.memberCount} {o.memberCount === 1 ? 'member' : 'members'}
                      {mustCount > 0 ? ` · ${mustCount} must-see` : ''}
                    </Text>
                  </View>
                  <View style={styles.overlapBadge}>
                    {/* DC25: 13 is off-grid; snap to iconSize.xs (12). */}
                    <Ionicons name="people" size={t.iconSize.xs} color={t.colors.accent.aqua} />
                    <Text style={styles.overlapBadgeText}>{o.memberCount}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )
      ) : null}

      {/* Full side-by-side compare matrix (members × sets). */}
      <TouchableOpacity
        testID="crew-action-compare-grid"
        style={styles.overlapToggle}
        onPress={() => router.push('/crew-compare')}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Open full compare grid"
      >
        <Ionicons name="grid-outline" size={t.iconSize.sm} color={t.colors.accent.aqua} />
        <Text style={styles.overlapToggleText}>Full compare grid</Text>
        <Ionicons name="chevron-forward" size={t.iconSize.sm} color={t.colors.accent.aqua} />
      </TouchableOpacity>

      {/* P2P plan handoff — discoverable from the Plan cluster so users
          find it before they need it. QR / SMS works with no signal. */}
      <TouchableOpacity
        testID="crew-action-share-plan-planning"
        style={styles.overlapToggle}
        onPress={() => router.push('/plan-share')}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Share offline: QR or text, works without signal"
      >
        <Ionicons name="qr-code-outline" size={t.iconSize.sm} color={t.colors.accent.aqua} />
        <View style={styles.overlapToggleLabelStack}>
          <Text style={styles.overlapToggleText}>{COPY.picks.shareOffline}</Text>
          <Text style={styles.overlapToggleHint}>QR or text, works without signal</Text>
        </View>
        <Ionicons name="chevron-forward" size={t.iconSize.sm} color={t.colors.accent.aqua} />
      </TouchableOpacity>

      <View style={styles.sectionLabelRow} onLayout={(e) => { planSectionY.current.polls = e.nativeEvent.layout.y; }}>
        <SectionLabel>Polls</SectionLabel>
        {openPollCount > 0 ? (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{openPollCount}</Text>
          </View>
        ) : null}
      </View>
      <CrewPolls crewId={crew.id} currentUserId={user.id} isOwner={isOwner} />

      {/* DC4: Packing + Rides are pre-festival planning, so they live in
          Plan (moved out of the mid-festival "Find" cluster). The count
          pills give an at-a-glance "what's outstanding" without expanding. */}
      <View style={styles.sectionLabelRow} onLayout={(e) => { planSectionY.current.packing = e.nativeEvent.layout.y; }}>
        <SectionLabel>Packing</SectionLabel>
        {packingDone ? (
          <View style={styles.donePill} accessibilityLabel="All packing items claimed">
            <Ionicons name="checkmark" size={t.iconSize.xs} color={t.colors.accent.aqua} />
            <Text style={styles.donePillText} maxFontSizeMultiplier={MAX_FONT_SCALE}>All packed</Text>
          </View>
        ) : packingLeft > 0 ? (
          <View
            style={styles.countBadge}
            accessibilityLabel={`${packingLeft} packing ${packingLeft === 1 ? 'item' : 'items'} unclaimed`}
          >
            <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{packingLeft}</Text>
          </View>
        ) : null}
      </View>
      <CrewPacking crewId={crew.id} currentUserId={user.id} isOwner={isOwner} />

      <View style={styles.sectionLabelRow} onLayout={(e) => { planSectionY.current.rides = e.nativeEvent.layout.y; }}>
        <SectionLabel>Rides</SectionLabel>
        {rideCount > 0 ? (
          <View
            style={styles.countBadge}
            accessibilityLabel={`${rideCount} ${rideCount === 1 ? 'ride' : 'rides'} on the board`}
          >
            <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{rideCount}</Text>
          </View>
        ) : null}
      </View>
      <CrewRides crewId={crew.id} currentUserId={user.id} isOwner={isOwner} />
    </ScrollView>
  );
}
