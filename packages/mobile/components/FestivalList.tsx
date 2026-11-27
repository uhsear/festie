import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, RefreshControl, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import { useAuthStore, useFestivalDataStore } from '@festie/shared/stores';
import { COPY, DISCOVER_COPY, FESTIVAL_STATUS_LABEL, FESTIVAL_SHARE_COPY } from '@festie/shared/constants';
import type { Festival } from '@festie/shared/types';
import { buildFestivalPageUrl, formatFestivalDateRange, festivalStatus, groupFestivalsByStatus, partitionSeriesBlocks, splitBySeries, type FestivalStatus } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, useLargeText, typeScaleCap, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import Button from './Button';
import LoadErrorState from './LoadErrorState';
import { Skeleton } from './Skeleton';
import FollowButton from './FollowButton';
import GuestLegalFooter from './GuestLegalFooter';

// Status pill styling. The list endpoint now provides startDate/endDate, so a
// festival classifies as upcoming/ongoing/past. Returns null when undetermined.
function statusBadge(status: FestivalStatus | null): { label: string; bg: string; fg: string } | null {
  // F6: Live badge fg must be onLightAccent (#0a0a0a) not onAccent (white).
  // White (#fff) on aqua (#00e8d0) is only ~1.45:1 — fails WCAG AA.
  // onLightAccent is the token-documented AA-safe pair for aqua fills.
  switch (status) {
    case 'ongoing':
      return { label: FESTIVAL_STATUS_LABEL.ongoing, bg: 'aqua', fg: 'onLightAccent' };
    case 'upcoming':
      return { label: FESTIVAL_STATUS_LABEL.upcoming, bg: 'secondary', fg: 'aqua' };
    case 'past':
      return { label: FESTIVAL_STATUS_LABEL.past, bg: 'secondary', fg: 'muted' };
    default:
      return null;
  }
}

interface FestivalCardProps {
  festival: Festival;
  onPress: (id: string) => void;
  isSelecting: boolean;
}

// useStyles must be defined at module level (makeStyles caches the sheet).
const useStyles = makeStyles((t) => ({
  centered: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[6],
  },
  // F20: empty/error states are wrapped in a flexGrow ScrollView so the
  // RefreshControl gesture works even when there is no list content.
  scrollCentered: {
    flexGrow: 1,
    backgroundColor: t.colors.bg.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[6],
  },
  selectError: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
    textAlign: 'center',
    marginTop: t.spacing[3],
  },
  emptyTitle: {
    // F7: festival name uses typeStyle('title') — Space Grotesk 600 brand face.
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  emptySubtitle: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  listContent: {
    padding: t.spacing[4],
  },
  separator: {
    height: t.spacing[3],
  },
  card: {
    flexDirection: 'row' as const,
    // Top-align so the chevron tracks the first line of the title, not the
    // vertical mid-point of a multi-line block (e.g. "North Coast Festival 2026").
    alignItems: 'flex-start' as const,
    backgroundColor: t.colors.bg.card,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
  },
  // Past festivals are de-emphasized structurally, not with a card-wide opacity.
  // opacity:0.55 dropped the text below AA and is invisible to screen readers;
  // a recessed background + lighter border (mirroring filterChipOff in
  // app/(tabs)/index.tsx) gives the same "recessed" cue while the existing "Past"
  // badge carries the explicit status.
  cardPast: {
    backgroundColor: t.colors.bg.primary,
    borderColor: t.colors.border.light,
  },
  seriesHeading: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  skeletonCard: {
    backgroundColor: t.colors.bg.card,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    marginBottom: t.spacing[3],
  },
  skeletonBody: {
    gap: t.spacing[2],
  },
  cardContent: {
    flex: 1,
    gap: t.spacing[1],
  },
  titleRow: {
    flexDirection: 'row' as const,
    // Top-align so badge and chevron pin to the first line of the title even
    // when a long festival name wraps to a second line (e.g. "North Coast
    // Festival 2026"). center-alignment caused them to float at mid-block.
    alignItems: 'flex-start' as const,
    gap: t.spacing[2],
  },
  festivalName: {
    flex: 1,
    // F7: typeStyle('title') resolves to Space Grotesk 600 — brand face.
    // Reserve lineHeight headroom so 600-weight glyphs (descenders/diacritics)
    // are not clipped when the OS bumps font scale on tablets/large-text settings.
    ...typeStyle('title'),
    lineHeight: Math.round(t.fontSize[24] * 1.3),
    color: t.colors.text.primary,
  },
  // R6: 9999px radius, 3px/10px padding, 10px Space Grotesk 600, 0.04em tracking.
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  badgeText: {
    // R6: weight 600 (SpaceGrotesk_600SemiBold), 0.04em tracking override from caps default.
    ...typeStyle('micro', 600),
    letterSpacing: (typeStyle('micro', 600).fontSize ?? 10) * 0.04,
  },
  metaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing[2],
  },
  metaText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  actionRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: t.spacing[2],
    marginTop: t.spacing[2],
  },
}));

function FestivalCard({ festival, onPress, isSelecting }: FestivalCardProps) {
  const styles = useStyles();
  const t = useTokens();
  const largeText = useLargeText();
  const dateRange = formatFestivalDateRange(festival.startDate, festival.endDate);
  const status = festivalStatus(festival);
  const badgeSpec = statusBadge(status);
  const isPast = status === 'past';

  // Resolve badge colors from tokens at render time.
  const badgeBgColor = badgeSpec?.bg === 'aqua' ? t.colors.accent.aqua : t.colors.bg.secondary;
  const badgeFgColor =
    badgeSpec?.fg === 'onLightAccent'
      ? t.colors.text.onLightAccent
      : badgeSpec?.fg === 'aqua'
        ? t.colors.accent.aqua
        : t.colors.text.muted;

  // Compose the card's pieces into one accessible name so a screen reader reads
  // "<name>, <status>, <dates>, <location>" as a single button instead of fragments.
  const progressLabel = festival.scheduleProgress ? DISCOVER_COPY.scheduleProgress[festival.scheduleProgress] : null;
  const a11yLabel = [festival.name, badgeSpec?.label, progressLabel, dateRange, festival.location].filter(Boolean).join(', ');

  const followable = status === 'upcoming' || status === null;
  const shareSlug = festival.slug;

  const handleShare = () => {
    if (!shareSlug) return;
    const url = buildFestivalPageUrl(shareSlug, undefined, 'share-festival');
    // Android ignores `url`, so the message carries the link.
    Share.share({ message: `${FESTIVAL_SHARE_COPY.text(festival.name)}: ${url}`, url, title: festival.name }).catch(
      () => undefined,
    );
  };

  return (
    <View>
    <TouchableOpacity
      testID={`festival-card-${festival.id}`}
      style={[styles.card, isPast && styles.cardPast, largeText && { padding: t.spacing[3] }]}
      onPress={() => onPress(festival.id)}
      activeOpacity={0.7}
      disabled={isSelecting}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ disabled: isSelecting }}
    >
      <View style={styles.cardContent}>
        <View style={styles.titleRow}>
          <Text
            style={styles.festivalName}
            numberOfLines={3}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={typeScaleCap('title')}
          >
            {festival.name}
          </Text>
          {badgeSpec ? (
            <View style={[styles.badge, { backgroundColor: badgeBgColor }]}>
              <Text style={[styles.badgeText, { color: badgeFgColor }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>{badgeSpec.label}</Text>
            </View>
          ) : null}
        </View>
        {dateRange ? (
          <View style={styles.metaRow}>
            <Ionicons
              name="calendar-outline"
              size={t.iconSize.compact}
              color={t.colors.text.secondary}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={styles.metaText}>{dateRange}</Text>
          </View>
        ) : null}
        {progressLabel ? (
          <View style={styles.metaRow}>
            <Ionicons
              name="list-outline"
              size={t.iconSize.compact}
              color={t.colors.text.secondary}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={styles.metaText}>{progressLabel}</Text>
          </View>
        ) : null}
        {festival.location ? (
          <View style={styles.metaRow}>
            <Ionicons
              name="location-outline"
              size={t.iconSize.compact}
              color={t.colors.text.secondary}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={styles.metaText} numberOfLines={2}>
              {festival.location}
            </Text>
          </View>
        ) : null}
      </View>
      <Ionicons
        name="chevron-forward"
        size={t.iconSize.md}
        color={t.colors.text.muted}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </TouchableOpacity>
    {followable || festival.slug ? (
      <View style={styles.actionRow}>
        {followable ? <FollowButton festivalId={festival.id} festivalName={festival.name} /> : null}
        {festival.slug ? (
          <Button
            label={FESTIVAL_SHARE_COPY.button}
            variant="secondary"
            size="sm"
            icon="share-outline"
            onPress={handleShare}
            accessibilityLabel={FESTIVAL_SHARE_COPY.a11y(festival.name)}
            testID={`festival-share-${festival.id}`}
          />
        ) : null}
      </View>
    ) : null}
    </View>
  );
}

// Stable separator component — avoids recreating on every render.
function ListSeparator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

type ListRow =
  | { kind: 'series'; key: string; label: string }
  | { kind: 'festival'; key: string; festival: Festival };

interface FestivalListProps {
  /** Called after selectFestival resolves, so a picker overlay can close itself. */
  onSelected?: () => void;
}

export default function FestivalList({ onSelected }: FestivalListProps = {}) {
  const [selectError, setSelectError] = useState(false);
  const styles = useStyles();
  const t = useTokens();
  const festivals = useFestivalDataStore((s) => s.festivals);
  const isLoading = useFestivalDataStore((s) => s.isLoading);
  const error = useFestivalDataStore((s) => s.error);
  const isGuest = useAuthStore((s) => !s.user);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);
  const haptics = useHaptics();

  // Order: live first, then upcoming (soonest first), then past (most recent
  // first), so the festivals a user is most likely choosing sit at the top.
  // Editions of one recurring festival sit together under the series name. A series with an edition
  // that has not ended goes ahead of the rest, under an "Other festivals" heading for the rest; a series
  // whose editions are all over goes last.
  const listRows = useMemo<ListRow[]>(() => {
    const g = groupFestivalsByStatus(festivals);
    const { series, standalone } = splitBySeries([...g.live, ...g.upcoming, ...g.past, ...g.undated]);
    const { current, ended } = partitionSeriesBlocks(series);
    const rest = groupFestivalsByStatus(standalone);
    const festivalRow = (festival: Festival): ListRow => ({ kind: 'festival', key: festival.id, festival });
    const blockRows = (block: (typeof series)[number]): ListRow[] => [
      { kind: 'series', key: `series-${block.key}`, label: block.label },
      ...block.editions.map(festivalRow),
    ];
    const standaloneRows = [...rest.live, ...rest.upcoming, ...rest.past, ...rest.undated].map(festivalRow);
    return [
      ...current.flatMap(blockRows),
      ...(current.length > 0 && standaloneRows.length > 0
        ? [{ kind: 'series' as const, key: 'heading-other-festivals', label: 'Other festivals' }]
        : []),
      ...standaloneRows,
      ...ended.flatMap(blockRows),
    ];
  }, [festivals]);

  const handleRefresh = useCallback(() => {
    loadFestivals().catch(() => {});
  }, [loadFestivals]);

  const handleSelect = useCallback(
    (id: string) => {
      // A light selection tick confirms the tap landed before the (possibly
      // brief network) festival load resolves.
      haptics.select();
      setSelectError(false);
      selectFestival(id)
        .then(() => onSelected?.())
        .catch((err) => {
          Sentry.captureException(err);
          setSelectError(true);
        });
    },
    [haptics, selectFestival, onSelected],
  );

  const renderItem = useCallback(
    ({ item }: { item: ListRow }) =>
      item.kind === 'series' ? (
        <Text style={styles.seriesHeading} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {item.label}
        </Text>
      ) : (
        <FestivalCard festival={item.festival} onPress={handleSelect} isSelecting={isLoading} />
      ),
    [handleSelect, isLoading, styles],
  );

  const keyExtractor = useCallback((item: ListRow) => item.key, []);

  const refreshControl = (
    <RefreshControl
      refreshing={isLoading}
      onRefresh={handleRefresh}
      tintColor={t.colors.accent.aqua}
      colors={[t.colors.accent.aqua]}
      progressBackgroundColor={t.colors.bg.secondary}
    />
  );

  // Initial loading state (no data yet) — skeleton cards matching the real list
  // geometry instead of a bare spinner.
  if (isLoading && festivals.length === 0) {
    return (
      <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel="Loading festivals">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.skeletonCard}>
            <View style={styles.skeletonBody}>
              <Skeleton width="64%" height={18} radius={t.radii.xs} />
              <Skeleton width="44%" height={14} radius={t.radii.xs} />
              <Skeleton width="52%" height={14} radius={t.radii.xs} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  // Error state with retry — wrapped in ScrollView so pull-to-refresh works.
  if (error && festivals.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.scrollCentered} refreshControl={refreshControl}>
        <LoadErrorState
          title={COPY.festivalLoad.errorTitle}
          message={error ?? COPY.festivalLoad.errorBody}
          action={{ label: COPY.festivalLoad.retry, onPress: handleRefresh }}
        />
      </ScrollView>
    );
  }

  // Empty state — F20: wrap in ScrollView with RefreshControl so the
  // "Pull down to refresh" gesture actually works; the static View branch
  // had no RefreshControl, making the instruction impossible to follow.
  if (!isLoading && festivals.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.scrollCentered} refreshControl={refreshControl}>
        <Ionicons name="musical-notes-outline" size={t.iconSize.xl} color={t.colors.text.muted} />
        <Text style={styles.emptyTitle}>No festivals available</Text>
        <Text style={styles.emptySubtitle}>Pull down to refresh</Text>
      </ScrollView>
    );
  }

  return (
    <FlatList
      data={listRows}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={ListSeparator}
      refreshControl={refreshControl}
      ListFooterComponent={
        <>
          {selectError ? (
            <Text style={styles.selectError} accessibilityRole="alert">
              Couldn&apos;t load that festival. Check your signal and try again.
            </Text>
          ) : null}
          {isGuest ? <GuestLegalFooter /> : null}
        </>
      }
    />
  );
}
