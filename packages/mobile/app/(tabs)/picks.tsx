import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
  TextInput,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore, useFestivalDataStore } from '@festie/shared/stores';
import { usePicks, useFestival, usePicksPlan, usePickClear, useBulkAddPicks } from '@festie/shared/hooks';
import type { FestivalSet, Priority } from '@festie/shared/types';
import type { ConflictGroup } from '@festie/shared/utils';
import {
  artistDisplayName,
  hasOfflineBasemap,
  festivalPhase,
  buildBulkPickGroups,
  BULK_SCOPE_LABEL,
  type PicksRow,
  type PicksFilter,
  type PicksGroupMode,
  type PicksOrder,
  formatTime,
  buildPicksIcs,
  buildPicksShareUrl,
} from '@festie/shared/utils';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { COPY, GUEST_PROMPT_COPY, PRIORITY_SYMBOLS, clashCount } from '@festie/shared/constants';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useHaptics } from '../../hooks/useHaptics';
import { duration as motionDuration } from '@festie/shared/tokens';
import { setReturnTo } from '../../lib/returnTo';
import { safeStageColor } from '../../lib/stageColor';
import { priorityColor } from '../../lib/priorityColor';
import { undoNotifier } from '../../lib/undoNotifier';
import { priorityIconName } from '../../lib/prioritySymbol';
import { CONCEPT_IONICON } from '../../lib/conceptIcons';
import ScreenHeader from '../../components/ScreenHeader';
import EmptyState from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import SetCardMobile from '../../components/SetCardMobile';
import CrewSuggestionStrip from '../../components/CrewSuggestionStrip';
import OfflineReadinessCard from '../../components/OfflineReadinessCard';


const PRIORITY_CHOICES: readonly { value: Priority; label: string }[] = [
  { value: 'must', label: PRIORITY_SYMBOLS.must.short },
  { value: 'want-to-see', label: PRIORITY_SYMBOLS['want-to-see'].short },
  { value: 'maybe', label: PRIORITY_SYMBOLS.maybe.short },
];

/**
 * A flattened list row: a collapsible group header, a sub-group header, or a
 * picked set. One FlatList (rather than nested .map in a ScrollView) keeps list
 * virtualization across the whole picks plan. Built by the shared usePicksPlan.
 */
type Row = PicksRow;

const colorOf = (t: Parameters<typeof priorityColor>[0], p?: Priority) => (p ? priorityColor(t, p) : undefined);

const SCROLL_TOP_THRESHOLD = 520;

export default function PicksScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const haptics = useHaptics();

  // Respect the iOS home indicator (~34pt on iPhone 12+/13+/14+) so the last
  // picks scroll clear of the tab bar / indicator with a little breathing room.
  // The static `listContent` style can't read `insets`, so layer it on inline.
  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) }],
    [styles.listContent, insets.bottom, t.spacing],
  );

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const user = useAuthStore((s) => s.user);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const sets = useFestivalDataStore((s) => s.sets);
  const stages = useFestivalDataStore((s) => s.stages);
  // Raw festival days (FestivalDay[]) — needed for the TZ-/date-aware interval
  // math in getSetTimeBounds / buildPickConflicts, which index `days[dayIndex]`
  // positionally. The lightweight `getDays()` shape below (index/label/date) is
  // kept separate for the UI grouping headers.
  const storeDays = useFestivalDataStore((s) => s.days);
  const isLoading = useFestivalDataStore((s) => s.isLoading);
  const error = useFestivalDataStore((s) => s.error);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);

  const [exportBusy, setExportBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPriority, setBulkPriority] = useState<Priority>('must');

  // ── Organize / focus controls (shared with web) ─────────────────────────
  const plan = usePicksPlan();
  const {
    groupMode,
    order,
    setOrder,
    effectiveFilter,
    search,
    setSearch,
    stats,
    conflictGroups,
    rows,
    filtersActive,
    toggleCollapsed,
    toggleFilter,
    setGroupMode,
    clearFilters: clearPlanFilters,
  } = plan;
  const [searchOpen, setSearchOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  const { getMyPick, savePick, getMyNote, getMyReminder } = usePicks();
  const { getDays, getStageColor, getStageName } = useFestival();
  const clearPick = usePickClear(undoNotifier);
  const { busyKey: bulkBusyKey, add: bulkAdd } = useBulkAddPicks(undoNotifier);

  const days = useMemo(() => getDays(), [getDays]);
  const conflictIds = plan.clashIds;

  // The festival's offline vector basemap archive, when one has been authored
  // for it. Null for every other festival, which makes the download card omit
  // the map step entirely rather than offer a control that can never succeed.
  const offlineBasemapUrl = useMemo(
    () => (hasOfflineBasemap(currentFestival?.mapConfig) ? currentFestival.mapConfig.offlineBasemap.pmtilesUrl : null),
    [currentFestival],
  );

  const handlePickChange = useCallback(
    (set: FestivalSet, priority: Priority | null) => {
      if (!currentFestival) return;
      if (priority === null) {
        haptics.select();
        clearPick(set.id, artistDisplayName(set, currentFestival.b2bSeparator));
      } else {
        savePick(currentFestival.id, set.id, priority).catch((e) => {
          haptics.warning();
          undoNotifier.error(mapErrorToUserMessage(e, "Couldn't save your pick. Try again."));
        });
      }
    },
    [currentFestival, savePick, clearPick, haptics],
  );

  const toggleCollapse = useCallback(
    (groupId: string) => {
      haptics.tap();
      toggleCollapsed(groupId);
    },
    [haptics, toggleCollapsed],
  );

  const setFocusFilter = useCallback(
    (next: PicksFilter) => {
      haptics.select();
      // Tap an active chip to clear it (back to the whole plan).
      toggleFilter(next);
    },
    [haptics, toggleFilter],
  );

  const setGroupModeHaptic = useCallback(
    (mode: PicksGroupMode) => {
      haptics.select();
      setGroupMode(mode);
    },
    [haptics, setGroupMode],
  );

  const setOrderHaptic = useCallback(
    (next: PicksOrder) => {
      haptics.select();
      setOrder(next);
    },
    [haptics, setOrder],
  );

  const clearFilters = useCallback(() => {
    haptics.tap();
    clearPlanFilters();
    setSearchOpen(false);
  }, [haptics, clearPlanFilters]);

  // ── Bulk pick helpers ───────────────────────────────────────────────────
  // Group every cached set (all days) by stage and by artist genre so the user
  // can add a whole group in ONE coalesced write via useBulkAddPicks.
  const bulkGroups = useMemo(() => buildBulkPickGroups(sets, stages, getStageName), [sets, stages, getStageName]);
  const stageGroups = bulkGroups.stages;
  const genreGroups = bulkGroups.genres;
  const hasBulkGroups = stageGroups.length > 0 || genreGroups.length > 0;

  const handleBulkApply = useCallback(
    (group: (typeof stageGroups)[number]) => {
      bulkAdd(group, bulkPriority).then((result) => {
        if (result === 'added') haptics.success();
        else if (result === 'failed') haptics.warning();
      });
    },
    [bulkAdd, bulkPriority, haptics],
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'group') {
        return (
          <TouchableOpacity
            style={styles.dayHeader}
            onPress={() => toggleCollapse(item.groupId)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: !item.collapsed }}
            accessibilityLabel={`${item.label}, ${item.count} pick${item.count === 1 ? '' : 's'}, ${
              item.collapsed ? 'collapsed, double tap to expand' : 'expanded, double tap to collapse'
            }`}
          >
            {item.priority ? <View style={[styles.dot, { backgroundColor: colorOf(t, item.priority) }]} /> : null}
            <Text style={styles.dayLabel} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
              {item.label}
            </Text>
            <View style={styles.countPill}>
              <Text style={styles.countText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {item.count}
              </Text>
            </View>
            <Ionicons
              name={item.collapsed ? 'chevron-down' : 'chevron-up'}
              size={t.iconSize.sm}
              color={t.colors.text.muted}
            />
          </TouchableOpacity>
        );
      }
      if (item.kind === 'subgroup') {
        return (
          <View style={styles.sectionHeader} accessibilityRole="header">
            {item.priority ? <View style={[styles.dot, { backgroundColor: colorOf(t, item.priority) }]} /> : null}
            <Text style={styles.sectionLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {item.label}
            </Text>
            <View style={styles.countPill}>
              <Text style={styles.countText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {item.count}
              </Text>
            </View>
          </View>
        );
      }
      // No Reanimated entering/exiting/layout on rows: FlatList recycles and
      // re-mounts rows while scrolling, so each one replayed its animation and
      // the layout transition re-measured every visible row on each pick change.
      return (
        <SetCardMobile
          set={item.set}
          stageName={getStageName(item.set.stageId) || 'Unknown'}
          stageColor={safeStageColor(getStageColor(item.set.stageId), t.colors.text.muted)}
          myPick={getMyPick(item.set.id)}
          onPickChange={(priority) => handlePickChange(item.set, priority)}
          onPress={() => router.push(`/set/${item.set.id}`)}
          hasConflict={conflictIds.has(item.set.id)}
          hasNote={!!getMyNote(item.set.id)}
          reminderMinutes={getMyReminder(item.set.id)}
        />
      );
    },
    [
      styles,
      getStageName,
      getStageColor,
      getMyPick,
      getMyNote,
      getMyReminder,
      handlePickChange,
      conflictIds,
      router,
      t,
      toggleCollapse,
    ],
  );

  const keyExtractor = useCallback((item: Row) => item.key, []);

  const handleRefresh = useCallback(() => {
    if (currentFestival) {
      haptics.tap();
      selectFestival(currentFestival.id).catch(() => {});
    }
  }, [currentFestival, selectFestival, haptics]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setShowScrollTop((prev) => {
      const next = y > SCROLL_TOP_THRESHOLD;
      return prev === next ? prev : next;
    });
  }, []);

  const scrollToTop = useCallback(() => {
    haptics.tap();
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [haptics]);

  // Export the user's picks to a .ics the OS can import into any calendar app.
  // Built fully client-side from the already-loaded store data (no server call,
  // works offline) and shared via the OS sheet — same write/share flow as the
  // account data export.
  const handleExportCalendar = useCallback(async () => {
    if (!currentFestival || !currentProfile || exportBusy) return;
    setExportBusy(true);
    try {
      const ics = buildPicksIcs({
        festival: {
          id: currentFestival.id,
          name: currentFestival.name,
          location: currentFestival.location,
        },
        sets,
        stages,
        picks: currentProfile.picks,
        notes: currentProfile.notes,
      });
      const safeName = (currentFestival.name || 'festival').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      const file = new File(Paths.cache, `${safeName}_picks.ics`);
      file.create({ overwrite: true });
      file.write(ics);
      if (await Sharing.isAvailableAsync()) {
        haptics.success();
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/calendar',
          UTI: 'com.apple.ical.ics',
          dialogTitle: 'Add picks to calendar',
        });
      } else {
        Alert.alert('Sharing unavailable', 'Calendar sharing is not available on this device.');
      }
    } catch (e) {
      haptics.warning();
      Alert.alert("Couldn't export picks", mapErrorToUserMessage(e, 'Try again.'));
    } finally {
      setExportBusy(false);
    }
  }, [currentFestival, currentProfile, sets, stages, exportBusy, haptics]);

  // Nothing to export / share with zero picks — disable so the action can't
  // produce an empty .ics or share an empty plan.
  const noPicks = stats.total === 0;

  const calendarButton = (
    <TouchableOpacity
      style={[styles.calendarButton, (exportBusy || noPicks) && styles.calendarButtonDisabled]}
      onPress={handleExportCalendar}
      disabled={exportBusy || noPicks}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ disabled: exportBusy || noPicks }}
      accessibilityLabel="Add picks to calendar"
    >
      {exportBusy ? (
        <ActivityIndicator size="small" color={t.colors.accent.aqua} />
      ) : (
        <Ionicons name="calendar-outline" size={16} color={t.colors.accent.aqua} />
      )}
      <Text style={styles.calendarButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
        {exportBusy ? 'Exporting…' : 'Add to calendar'}
      </Text>
    </TouchableOpacity>
  );

  // Share a public, read-only link to my picks (server route GET /s/:profileId).
  const handleSharePicks = useCallback(() => {
    if (!currentProfile || !currentFestival) return;
    haptics.tap();
    const url = buildPicksShareUrl(currentProfile.id);
    Share.share({ message: `My ${currentFestival.name} picks on Festie: ${url}`, url }).catch(() => {});
  }, [currentProfile, currentFestival, haptics]);

  // ── At-a-glance summary + focus filter chips ─────────────────────────────
  const summaryRow =
    stats.total > 0 ? (
      <View style={styles.summaryRow}>
        <StatChip
          label="All"
          count={stats.total}
          active={effectiveFilter === 'all'}
          onPress={() => setFocusFilter('all')}
        />
        {stats.must > 0 ? (
          <StatChip
            label="Must"
            count={stats.must}
            color={t.colors.priority.must}
            icon={priorityIconName('must')}
            active={effectiveFilter === 'must'}
            onPress={() => setFocusFilter('must')}
          />
        ) : null}
        {stats.want > 0 ? (
          <StatChip
            label="Want"
            count={stats.want}
            color={t.colors.priority.want}
            icon={priorityIconName('want-to-see')}
            active={effectiveFilter === 'want-to-see'}
            onPress={() => setFocusFilter('want-to-see')}
          />
        ) : null}
        {stats.maybe > 0 ? (
          <StatChip
            label="Maybe"
            count={stats.maybe}
            color={t.colors.priority.maybe}
            icon={priorityIconName('maybe')}
            active={effectiveFilter === 'maybe'}
            onPress={() => setFocusFilter('maybe')}
          />
        ) : null}
        {stats.clashes > 0 ? (
          <StatChip
            label={COPY.clash.filter}
            count={stats.clashes}
            icon="warning"
            color={t.colors.accent.coral}
            danger
            active={effectiveFilter === 'clashes'}
            onPress={() => setFocusFilter('clashes')}
          />
        ) : null}
      </View>
    ) : null;

  const controlsRow =
    stats.total > 0 ? (
      <View style={styles.controlsRow}>
        <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Group picks by">
          {(['day', 'priority'] as const).map((mode) => {
            const activeMode = groupMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.segmentBtn, activeMode && styles.segmentBtnActive]}
                onPress={() => setGroupModeHaptic(mode)}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityState={{ selected: activeMode }}
                accessibilityLabel={mode === 'day' ? 'Group by day' : 'Group by priority'}
              >
                <Ionicons
                  name={mode === 'day' ? 'calendar-clear-outline' : 'flag-outline'}
                  size={t.iconSize.xs}
                  color={activeMode ? t.colors.accent.aqua : t.colors.text.muted}
                />
                <Text
                  style={[styles.segmentText, activeMode && styles.segmentTextActive]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  {mode === 'day' ? 'By day' : 'By priority'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.iconControl, (searchOpen || search.length > 0) && styles.iconControlActive]}
          onPress={() => {
            haptics.tap();
            setSearchOpen((v) => !v);
          }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ expanded: searchOpen }}
          accessibilityLabel={searchOpen ? 'Hide search' : 'Search my picks'}
        >
          <Ionicons
            name="search"
            size={t.iconSize.sm}
            color={searchOpen || search.length > 0 ? t.colors.accent.aqua : t.colors.text.muted}
          />
        </TouchableOpacity>
      </View>
    ) : null;

  const orderRow =
    stats.total > 0 ? (
      <View style={styles.controlsRow}>
        <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Order sets">
          {(['openers', 'headliners'] as const).map((value) => {
            const active = order === value;
            const label = value === 'openers' ? 'Openers first' : 'Headliners first';
            return (
              <TouchableOpacity
                key={value}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                onPress={() => setOrderHaptic(value)}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={label}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    ) : null;

  const searchField =
    stats.total > 0 && searchOpen ? (
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={t.colors.text.placeholder} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Filter picks by artist or stage"
          placeholderTextColor={t.colors.text.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={search.length === 0}
          returnKeyType="search"
          accessibilityLabel="Filter my picks"
        />
        {search.length > 0 ? (
          <TouchableOpacity
            style={styles.clearSearchButton}
            onPress={() => setSearch('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={18} color={t.colors.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
    ) : null;

  const bulkPanel = hasBulkGroups ? (
    <View style={styles.bulkPanel}>
      <TouchableOpacity
        style={styles.bulkHeader}
        onPress={() => {
          haptics.tap();
          setBulkOpen((v) => !v);
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ expanded: bulkOpen }}
        accessibilityLabel="Bulk add picks for all days"
      >
        <Ionicons name="add-circle-outline" size={16} color={t.colors.accent.aqua} />
        <Text style={styles.bulkHeaderText}>{`Bulk add picks · ${BULK_SCOPE_LABEL}`}</Text>
        <Ionicons
          name={bulkOpen ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={t.colors.text.muted}
          style={styles.bulkChevron}
        />
      </TouchableOpacity>

      {bulkOpen && (
        <View style={styles.bulkBody}>
          <View
            style={styles.bulkPriorityRow}
            accessibilityRole="radiogroup"
            accessibilityLabel="Priority for bulk add"
          >
            <Text style={styles.bulkSubLabel}>Add as</Text>
            {PRIORITY_CHOICES.map((p) => {
              const active = bulkPriority === p.value;
              return (
                <TouchableOpacity
                  key={p.value}
                  onPress={() => {
                    haptics.select();
                    setBulkPriority(p.value);
                  }}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${p.label} priority${active ? ', selected' : ''}`}
                  style={[styles.bulkChip, active && styles.bulkChipActive]}
                >
                  <Ionicons name={priorityIconName(p.value)} size={t.iconSize.xs} color={priorityColor(t, p.value)} />
                  <Text style={[styles.bulkChipText, active && styles.bulkChipTextActive]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {stageGroups.length > 0 && (
            <View style={styles.bulkGroup}>
              <Text style={styles.bulkSubLabel}>By stage</Text>
              <View style={styles.bulkPillRow}>
                {stageGroups.map((g) => (
                  <BulkPill
                    key={g.key}
                    label={g.label}
                    count={g.setIds.length}
                    busy={bulkBusyKey === g.key}
                    disabled={!!bulkBusyKey}
                    onPress={() => handleBulkApply(g)}
                  />
                ))}
              </View>
            </View>
          )}

          {genreGroups.length > 0 && (
            <View style={styles.bulkGroup}>
              <Text style={styles.bulkSubLabel}>By genre</Text>
              <View style={styles.bulkPillRow}>
                {genreGroups.map((g) => (
                  <BulkPill
                    key={g.key}
                    label={g.label}
                    count={g.setIds.length}
                    busy={bulkBusyKey === g.key}
                    disabled={!!bulkBusyKey}
                    onPress={() => handleBulkApply(g)}
                  />
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  ) : null;

  const picksHeader = (
    <View>
      <View style={styles.headerActions}>
        {calendarButton}
        <TouchableOpacity
          style={[styles.calendarButton, noPicks && styles.calendarButtonDisabled]}
          onPress={handleSharePicks}
          disabled={noPicks}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: noPicks }}
          accessibilityLabel="Share my picks"
        >
          <Ionicons name="share-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.calendarButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
            {COPY.picks.share}
          </Text>
        </TouchableOpacity>
      </View>
      {currentFestival && (
        <View style={styles.offlineCard}>
          <OfflineReadinessCard
            festivalId={currentFestival.id}
            pmtilesUrl={offlineBasemapUrl}
            festivalPast={festivalPhase(currentFestival, storeDays) === 'post'}
          />
        </View>
      )}
      {summaryRow}
      {controlsRow}
      {orderRow}
      {searchField}
      <CrewSuggestionStrip />
      <ClashBannerInline
        groups={conflictGroups}
        days={days}
        separator={currentFestival?.b2bSeparator}
        reduceMotion={reduceMotion}
      />
      {bulkPanel}
    </View>
  );

  const refreshControl = (
    <RefreshControl
      refreshing={isLoading}
      onRefresh={handleRefresh}
      tintColor={t.colors.accent.aqua}
      colors={[t.colors.accent.aqua]}
      progressBackgroundColor={t.colors.bg.secondary}
    />
  );

  // Distinguish "you have no picks at all" from "your filter/search hid them" so
  // the empty state is honest and offers the right next action.
  const emptyComponent =
    stats.total === 0 ? (
      <EmptyState
        illustration="noPicks"
        title="No picks yet"
        message="Browse the lineup and tap the sets you want to see."
        action={{ label: 'Browse the lineup', onPress: () => router.navigate('/(tabs)') }}
      />
    ) : effectiveFilter === 'clashes' && !search.trim() ? (
      // Only the genuine "no overlaps" case. If a search is active, the clash
      // cards may simply be hidden by the query — fall through to the
      // search/filter empty state below rather than falsely claiming all-clear.
      <EmptyState
        icon="checkmark-circle-outline"
        title={COPY.clash.none}
        message="Nothing on your plan overlaps — you're all set."
        action={{ label: 'Show all picks', onPress: clearFilters }}
      />
    ) : (
      <EmptyState
        icon="search-outline"
        title="No matching picks"
        message={search.trim() ? `Nothing matches “${search.trim()}”.` : 'No picks in this view.'}
        action={filtersActive ? { label: 'Clear filters', onPress: clearFilters } : undefined}
      />
    );

  if (!user) {
    return (
      <View style={styles.container} testID="picks-screen">
        <ScreenHeader title="Picks" icon="star" />
        <EmptyState
          icon="star-outline"
          title={GUEST_PROMPT_COPY.teasers.picks.title}
          message={GUEST_PROMPT_COPY.teasers.picks.message}
          action={{
            label: GUEST_PROMPT_COPY.createAccount,
            onPress: () => {
              setReturnTo('/(tabs)/picks');
              router.push('/(auth)/register');
            },
          }}
          secondaryAction={{
            label: GUEST_PROMPT_COPY.signIn,
            onPress: () => {
              setReturnTo('/(tabs)/picks');
              router.push('/(auth)/login');
            },
          }}
        />
      </View>
    );
  }

  let body: React.ReactNode;
  if (!currentFestival) {
    body = (
      <EmptyState
        icon="calendar-outline"
        title="No festival selected"
        message="Choose a festival from the Schedule tab to start saving picks."
      />
    );
  } else if (!currentProfile) {
    body = (
      <EmptyState
        icon="musical-note-outline"
        title="No picks yet"
        message="Tap Must See, Want to See or Maybe on any set to start your plan. Your first pick joins the festival."
        action={{ label: 'Go to Schedule', onPress: () => router.navigate('/(tabs)/') }}
      />
    );
  } else if (isLoading && stats.total === 0 && rows.length === 0) {
    body = <PicksSkeleton />;
  } else if (error && stats.total === 0) {
    body = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn’t load your picks"
        message={error}
        action={{ label: 'Try again', onPress: handleRefresh }}
      />
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={listContentStyle}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={picksHeader}
        ListEmptyComponent={emptyComponent}
        ItemSeparatorComponent={Separator}
        refreshControl={refreshControl}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}
      />
    );
  }

  return (
    <View style={styles.container} testID="picks-screen">
      <ScreenHeader title={COPY.picks.title} icon={CONCEPT_IONICON.picks} />
      <View style={styles.body}>{body}</View>
      {showScrollTop ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(motionDuration.fast)}
          exiting={reduceMotion ? undefined : FadeOut.duration(motionDuration.fast)}
          style={[styles.fab, { bottom: insets.bottom + t.spacing[4] }]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={styles.fabButton}
            onPress={scrollToTop}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Scroll to top"
          >
            <Ionicons name="arrow-up" size={t.iconSize.md} color={t.colors.text.onLightAccent} />
          </TouchableOpacity>
        </Animated.View>
      ) : null}
    </View>
  );
}

function Separator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

/** A summary + focus-filter chip ("Must · 8"). Tapping toggles the filter. */
function StatChip({
  label,
  count,
  color,
  icon,
  active,
  danger,
  onPress,
}: {
  label: string;
  count: number;
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const t = useTokens();
  const styles = useStyles();
  const accent = danger ? t.colors.accent.coral : t.colors.accent.aqua;
  return (
    <TouchableOpacity
      style={[styles.statChip, active && (danger ? styles.statChipActiveDanger : styles.statChipActive)]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${count}${active ? ', filtering' : ''}`}
    >
      {icon ? (
        <Ionicons name={icon} size={t.iconSize.xs} color={color ?? t.colors.text.muted} />
      ) : color ? (
        <View style={[styles.statDot, { backgroundColor: color }]} />
      ) : null}
      <Text
        style={[styles.statLabel, active && { color: accent }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        style={[styles.statCount, active && { color: accent }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={1}
      >
        {count}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * Cold-load placeholder for the picks plan — a day header plus a few set-card
 * shaped rows so the layout matches what's about to render (no spinner, no jump).
 */
function PicksSkeleton() {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.listContent} accessibilityRole="progressbar" accessibilityLabel="Loading your picks">
      <Skeleton width="40%" height={20} radius={t.radii.xs} style={styles.skeletonDay} />
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonCardMain}>
            <Skeleton width="62%" height={16} radius={t.radii.xs} />
            <Skeleton width="38%" height={12} radius={t.radii.xs} />
          </View>
          <Skeleton width={72} height={28} radius={t.radii.pill} />
        </View>
      ))}
    </View>
  );
}

/** A tappable bulk-add pill ("Main Stage · 8") used in the bulk panel. */
function BulkPill({
  label,
  count,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  count: number;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={[styles.bulkActionPill, disabled && !busy && styles.bulkActionPillDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Add all ${count} ${label} sets`}
    >
      {busy ? (
        <ActivityIndicator size="small" color={t.colors.accent.aqua} />
      ) : (
        <>
          <Text style={styles.bulkActionPillText} numberOfLines={1}>
            {label}
          </Text>
          <View style={styles.bulkActionCount}>
            <Text style={styles.bulkActionCountText}>{count}</Text>
          </View>
        </>
      )}
    </TouchableOpacity>
  );
}

/**
 * All-days set-time clash banner for the picks tab. Driven by the SAME
 * `buildPickConflicts` groups that feed the chip + the "clashes" filter (passed
 * in as `groups`), so those surfaces can never disagree. Unlike the schedule
 * tab's ClashBanner — which is scoped to the currently selected day — this spans
 * EVERY festival day (the picks tab has no day selector), so each card is tagged
 * with its day for context. Renders nothing when there are no clashes.
 */
function ClashBannerInline({
  groups,
  days,
  separator,
  reduceMotion,
}: {
  groups: ConflictGroup[];
  days: { index: number; date: string; label?: string }[];
  separator?: string;
  reduceMotion: boolean;
}) {
  const t = useTokens();
  const styles = useStyles();
  if (groups.length === 0) return null;
  return (
    <View style={styles.clashWrap}>
      <View style={styles.clashHeading}>
        <Ionicons name="warning-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
        <Text style={styles.clashHeadingText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {clashCount(groups.length)}
        </Text>
      </View>
      {groups.map((group) => (
        <ClashCardInline
          key={group.picks.map((p) => p.set.id).join('|')}
          group={group}
          days={days}
          separator={separator}
          reduceMotion={reduceMotion}
        />
      ))}
    </View>
  );
}

/** One clash card: the clashing acts + a "tap to decide" affordance. */
function ClashCardInline({
  group,
  days,
  separator,
  reduceMotion,
}: {
  group: ConflictGroup;
  days: { index: number; date: string; label?: string }[];
  separator?: string;
  reduceMotion: boolean;
}) {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();

  const keep = group.picks.find((p) => p.set.id === group.recommendedKeepId) ?? group.picks[0];
  if (!keep) return null;
  const keepName = artistDisplayName(keep.set, separator);
  // The moment both acts are on stage = the latest start among the group.
  const latest = group.picks.reduce((a, b) => (b.startMs > a.startMs ? b : a));
  const atLabel = formatTime(latest.set.startTime);
  const dayLabel = days.find((d) => d.index === (latest.set.dayIndex ?? 0))?.label;
  const overlapLabel = group.overlapMin > 0 ? `${group.overlapMin} min overlap` : 'overlapping sets';
  const a11yNames = group.picks.map((p) => artistDisplayName(p.set, separator)).join(', ');
  // "Sat · 8:30 PM · 30 min overlap" — day prefix disambiguates across the plan.
  const timeLabel = [dayLabel, atLabel, overlapLabel].filter(Boolean).join(' · ');

  const card = (
    <TouchableOpacity
      style={styles.clashCard}
      activeOpacity={0.8}
      onPress={() => router.push(`/set/${keep.set.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Schedule clash${dayLabel ? ` on ${dayLabel}` : ''}${
        atLabel ? ` at ${atLabel}` : ''
      }: ${a11yNames}. Recommended keep ${keepName}. Tap to decide.`}
    >
      <View style={styles.clashCardHead}>
        <Text style={styles.clashCardTime} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
          {timeLabel}
        </Text>
        <View style={styles.clashDecideRow}>
          <Text style={styles.clashDecideText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Tap to decide
          </Text>
          <Ionicons name="chevron-forward" size={t.iconSize.xs} color={t.colors.accent.aqua} />
        </View>
      </View>
      <View style={styles.clashActList}>
        {group.picks.map((pick) => {
          const recommended = pick.set.id === group.recommendedKeepId;
          return (
            <View key={pick.set.id} style={styles.clashActRow}>
              <View style={[styles.clashPriorityDot, { backgroundColor: priorityColor(t, pick.priority) }]} />
              <Text
                style={[styles.clashActName, recommended && styles.clashActNameKeep]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {artistDisplayName(pick.set, separator)}
              </Text>
              {recommended ? (
                <View style={styles.clashKeepTag}>
                  <Text style={styles.clashKeepTagText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    Keep
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </TouchableOpacity>
  );

  if (reduceMotion) return card;
  return <Animated.View entering={FadeIn.duration(motionDuration.med)}>{card}</Animated.View>;
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  body: {
    flex: 1,
  },
  listContent: {
    padding: t.spacing[4],
    paddingBottom: t.spacing[6],
  },
  headerActions: {
    flexDirection: 'row',
    gap: t.spacing[2],
    marginBottom: t.spacing[2],
  },
  offlineCard: {
    marginBottom: t.spacing[3],
  },
  calendarButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
  },
  calendarButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
    flexShrink: 1,
  },
  calendarButtonDisabled: {
    opacity: 0.5,
  },
  separator: {
    height: t.spacing[2],
  },
  // ── Inline all-days clash banner ──────────────────────────────────────────
  clashWrap: {
    marginBottom: t.spacing[2],
    gap: t.spacing[2],
  },
  clashHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  clashHeadingText: {
    ...typeStyle('label'),
    color: t.colors.accent.coral,
  },
  clashCard: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    borderLeftWidth: 4,
    backgroundColor: t.colors.bg.card,
    padding: t.spacing[3],
    gap: t.spacing[2],
  },
  clashCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[2],
  },
  clashCardTime: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  clashDecideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  clashDecideText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  clashActList: {
    gap: t.spacing[1],
  },
  clashActRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  clashPriorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  clashActName: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  clashActNameKeep: {
    ...typeStyle('body', 700),
    color: t.colors.text.primary,
  },
  clashKeepTag: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  clashKeepTagText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  // ── Summary / focus-filter chips ─────────────────────────────────────────
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: t.spacing[2],
    marginBottom: t.spacing[2],
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.card,
    minHeight: 44,
  },
  statChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  statChipActiveDanger: {
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  statCount: {
    ...typeStyle('caption', 700),
    color: t.colors.text.primary,
  },
  // ── Organize controls (group toggle + search) ────────────────────────────
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    marginBottom: t.spacing[2],
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    gap: t.spacing[1],
    padding: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.sm,
    minHeight: 44,
  },
  segmentBtnActive: {
    backgroundColor: t.colors.aquaAlpha[12],
  },
  segmentText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  segmentTextActive: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  iconControl: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  iconControlActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    marginBottom: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  searchInput: {
    flex: 1,
    ...typeStyle('body'),
    color: t.colors.text.primary,
    padding: 0,
  },
  clearSearchButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Cold-load skeleton ────────────────────────────────────────────────────
  skeletonDay: {
    marginTop: t.spacing[4],
    marginBottom: t.spacing[3],
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    padding: t.spacing[4],
    minHeight: 72,
    marginBottom: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  skeletonCardMain: {
    flex: 1,
    gap: t.spacing[2],
  },
  // ── Bulk add panel ──────────────────────────────────────────────────────
  bulkPanel: {
    marginBottom: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
    overflow: 'hidden',
  },
  bulkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  bulkHeaderText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  bulkChevron: {
    marginLeft: 'auto',
  },
  bulkBody: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
    gap: t.spacing[3],
  },
  bulkPriorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  bulkGroup: {
    gap: t.spacing[2],
  },
  bulkSubLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  bulkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    minHeight: 44,
  },
  bulkChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bulkChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
  },
  bulkChipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  bulkChipTextActive: {
    color: t.colors.accent.aqua,
  },
  bulkPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  bulkActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
    minHeight: 44,
    maxWidth: '100%',
  },
  bulkActionPillDisabled: {
    opacity: 0.5,
  },
  bulkActionPillText: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    // No capitalize transform — it mangled multi-word/initialism genres
    // ("drum and bass", "UK garage"). Labels carry their original casing.
    flexShrink: 1,
  },
  bulkActionCount: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.card,
  },
  bulkActionCountText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    marginTop: t.spacing[4],
    marginBottom: t.spacing[2],
    minHeight: 44,
  },
  dayLabel: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    marginTop: t.spacing[3],
    marginBottom: t.spacing[1],
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sectionLabel: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  countPill: {
    marginLeft: 'auto',
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.card,
  },
  countText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  // ── Scroll-to-top FAB ─────────────────────────────────────────────────────
  fab: {
    position: 'absolute',
    right: t.spacing[4],
  },
  fabButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
    // Soft elevation so the FAB floats above the list on both platforms.
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
}));
