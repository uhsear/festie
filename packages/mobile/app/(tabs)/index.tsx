import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  BackHandler,
  Platform,
  useWindowDimensions,
  type ListRenderItem,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFestivalDataStore, useFestivalStore, useAuthStore, useUIStore } from '@festie/shared/stores';
import { usePicks, useFestival } from '@festie/shared/hooks';
import {
  artistDisplayName,
  getSetHotness,
  getConflictingSetIds,
  setMinuteRange,
  festivalPhase,
  byStartTime,
  festivalTimeLabel,
  resolveFestivalTimeZone,
  searchOtherDays,
  searchEmptyCopy,
  searchHiddenByFilters,
  SCHEDULE_VIEWS,
  SCHEDULE_GROUP_BYS,
  groupScheduleSets,
  defaultScheduleView,
  hasAnyPick,
  isStageFilterActive,
  toggleStageFilter,
  toggleHiddenDay,
  scheduleEmptyCopy,
  scheduleEmptyReason,
  scheduleResultsSummary,
  visibleDayIndexes,
  type ScheduleView,
  type ScheduleGroupBy,
} from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useListBottomInset } from '../../hooks/useListBottomInset';
import { safeStageColor } from '../../lib/stageColor';
import type { TimeBounds } from '../../hooks/useNowIndicator';
import { useHaptics } from '../../hooks/useHaptics';
import { useNow } from '../../hooks/useNow';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import SegmentedControl from '../../components/SegmentedControl';
import NowNextStrip from '../../components/NowNextStrip';
import PhaseHomeActions from '../../components/PhaseHomeActions';
import ScheduleDayChips from '../../components/ScheduleDayChips';
import ScheduleResultsRow from '../../components/ScheduleResultsRow';
import FestivalList from '../../components/FestivalList';
import FreshnessChip from '../../components/FreshnessChip';
import SaveStatusChip from '../../components/SaveStatusChip';
import OtherDayMatches from '../../components/OtherDayMatches';
import SetCardMobile from '../../components/SetCardMobile';
import EmptyState from '../../components/EmptyState';
import ScreenHeader from '../../components/ScreenHeader';
import { Skeleton } from '../../components/Skeleton';
import TimelineView from '../../components/TimelineView';
import TBASection from '../../components/TBASection';

const SLOT_MINUTES = 15;
const IOS_NATIVE_TAB_BAR_HEIGHT = 49;

// Mobile schedule views, in the shared order: Cards, Timeline, then Grid. Grid
// is a pushed route, not a view the Schedule tab can show or remember (T18 makes
// it in-place). It rides in the switcher (instead of a header icon) so Find your
// crew keeps its header slot on 360dp phones.
const VIEW_OPTIONS_WITH_GRID: readonly { value: ScheduleView; label: string }[] = SCHEDULE_VIEWS.map((v) => ({
  value: v.key,
  label: v.label,
}));
const VIEW_OPTIONS = VIEW_OPTIONS_WITH_GRID.filter((v) => v.value !== 'grid');
const GROUP_BY_OPTIONS: readonly { value: ScheduleGroupBy; label: string }[] = SCHEDULE_GROUP_BYS.map((g) => ({
  value: g.key,
  label: g.label,
}));

type ListRow =
  | { kind: 'groupHeader'; key: string; label: string; stageColor?: string }
  | { kind: 'set'; key: string; set: FestivalSet };

export default function TimelineScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const haptics = useHaptics();
  const reduceMotion = useReduceMotion();
  const { scheduleView: scheduleViewParam } = useLocalSearchParams<{ scheduleView?: string | string[] }>();
  const requestedView = Array.isArray(scheduleViewParam) ? scheduleViewParam[0] : scheduleViewParam;
  const requestedViewMode: 'cards' | 'timeline' | null =
    requestedView === 'cards' || requestedView === 'timeline' ? requestedView : null;
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Responsive horizontal gutter. Phones keep the standard spacing[4] (16px)
  // edge padding. On tablet-class widths a flat 16px gutter leaves the chrome
  // (search bar, day/filter chips, view switcher) stranded against huge empty
  // sidebars, so we widen the gutter and cap the content column — when the
  // window is wider than maxContentWidth the extra space is split evenly,
  // centering the content instead of stretching it edge-to-edge.
  // NativeTabs floats above screen content on iOS, so shrink the scroll viewport
  // by its chrome + home-indicator height. Keep the normal 24pt list-end cushion
  // inside that viewport; padding alone still lets rows paint under the tab bar.
  // Android's Material tab bar already lays the body out above itself.
  const listBottomPad = useListBottomInset({ includeSafeArea: false });
  const scheduleViewportBottomInset = Platform.OS === 'ios' ? IOS_NATIVE_TAB_BAR_HEIGHT + insets.bottom : 0;
  const isTablet = width >= 700;
  const maxContentWidth = 760;
  const hPad = useMemo(() => {
    if (!isTablet) return t.spacing[4];
    const centered = (width - maxContentWidth) / 2;
    return Math.max(t.spacing[8], centered);
  }, [isTablet, width, t.spacing]);

  const festivals = useFestivalDataStore((s) => s.festivals);
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestivalId);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);
  const loadProfiles = useFestivalDataStore((s) => s.loadProfiles);
  const user = useAuthStore((s) => s.user);
  const isLoading = useFestivalDataStore((s) => s.isLoading);
  const error = useFestivalDataStore((s) => s.error);
  const stages = useFestivalDataStore((s) => s.stages);
  const allSets = useFestivalDataStore((s) => s.sets);

  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const setSearchQuery = useFestivalStore((s) => s.setSearchQuery);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const setActiveStages = useFestivalStore((s) => s.setActiveStages);
  const onlyMine = useFestivalStore((s) => s.onlyMine);
  const setOnlyMine = useFestivalStore((s) => s.setOnlyMine);
  const scheduleView = useFestivalStore((s) => s.scheduleView);
  const setScheduleView = useFestivalStore((s) => s.setScheduleView);
  const hiddenDays = useFestivalStore((s) => s.hiddenDays);
  const setHiddenDays = useFestivalStore((s) => s.setHiddenDays);
  const dismissedPhase = useFestivalStore((s) => s.dismissedPhase);
  const dismissPhaseBand = useFestivalStore((s) => s.dismissPhaseBand);
  const prefsFestivalId = useFestivalStore((s) => s.prefsFestivalId);
  const groupBy = useFestivalStore((s) => s.scheduleGroupBy) ?? 'time';
  const setScheduleGroupBy = useFestivalStore((s) => s.setScheduleGroupBy);

  const { getDays, getFilteredSets, getStageColor, getStageName } = useFestival();
  const { getMyPick, getOtherPicks, getMyNote, savePick } = usePicks();

  // DC1 — search bar and the stage/my-picks + phase-action setup chrome fold
  // behind a compact icon row so the timeline owns the viewport on small
  // phones. Day chips stay always visible (the one mid-festival control). Both
  // panels auto-open when they carry active state (a live search / a stage or
  // my-picks filter) so a user can't lose track of a filter that's hiding rows.
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Cards view: a scroll-to-top affordance for long lineups. We track whether
  // the list is scrolled past a threshold and expose a ref to snap it back.
  const listRef = useRef<FlatList<ListRow>>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  // useNow ticks, so the "today" dot follows the festival's own day (06:00
  // cutoff, festival zone) rather than the device calendar.
  const nowMs = useNow();

  // The swap button opens the festival picker over the loaded lineup instead of
  // clearing it, so a failed or cancelled switch (or no signal) loses nothing.
  const [pickingFestival, setPickingFestival] = useState(false);
  const offlineMode = useUIStore((s) => s.offlineMode);

  useEffect(() => {
    if (festivals.length === 0) {
      loadFestivals().catch(() => {});
    }
  }, [festivals.length, loadFestivals]);

  // The persisted festival data is restored; this reloads it when only the id survived.
  useEffect(() => {
    if (currentFestivalId && !currentFestival && !isLoading) {
      selectFestival(currentFestivalId).catch(() => {});
    }
  }, [currentFestivalId, currentFestival, isLoading, selectFestival]);

  // When a guest signs in while a festival is already selected, the profiles
  // weren't fetched (selectFestival skips them for guests). Load them now so
  // picks/notes light up without forcing a manual festival re-select.
  useEffect(() => {
    if (user && currentFestivalId && !currentProfile) {
      loadProfiles(currentFestivalId).catch(() => {});
    }
  }, [user, currentFestivalId, currentProfile, loadProfiles]);

  // Pull-to-refresh: re-fetch the selected festival's sets/stages/profile, or
  // the festival list when sitting on the picker. Mirrors FestivalList.
  const handleRefresh = useCallback(() => {
    if (currentFestival) {
      selectFestival(currentFestival.id).catch(() => {});
    } else {
      loadFestivals().catch(() => {});
    }
  }, [currentFestival, selectFestival, loadFestivals]);

  const refreshControl = (
    <RefreshControl
      refreshing={isLoading}
      onRefresh={handleRefresh}
      tintColor={t.colors.accent.aqua}
      colors={[t.colors.accent.aqua]}
      progressBackgroundColor={t.colors.bg.secondary}
    />
  );

  // Does this festival have any timed sets at all? A festival whose lineup is
  // published without set times (everything TBA) renders nothing in the
  // Timeline/Grid views — Cards is the only useful view for it.
  const festivalHasTimedSets = useMemo(() => allSets.some((s) => s.startTime && s.endTime), [allSets]);

  // Shared /cards and /timeline links carry an explicit mobile view request. It
  // is stored once the UI store has restored this festival's remembered choices
  // (a cached festival can render before that), then the one-shot param is cleared.
  useEffect(() => {
    if (!requestedViewMode || !currentFestival?.id || prefsFestivalId !== currentFestival.id) return;
    setScheduleView(requestedViewMode);
    router.setParams({ scheduleView: undefined });
  }, [currentFestival?.id, prefsFestivalId, requestedViewMode, router, setScheduleView]);

  // Android Back should dismiss transient schedule chrome before it exits the
  // root tab. useFocusEffect matters because native tabs keep screens mounted.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (showSearch) {
          setSearchQuery('');
          setShowSearch(false);
          return true;
        }
        if (showFilters) {
          setShowFilters(false);
          return true;
        }
        if (pickingFestival) {
          setPickingFestival(false);
          return true;
        }
        return false;
      });
      return () => subscription.remove();
    }, [setSearchQuery, pickingFestival, showFilters, showSearch]),
  );

  const days = useMemo(() => getDays(), [getDays]);
  const festivalTimeZone = resolveFestivalTimeZone(currentFestival);
  const zoneLabel = festivalTimeLabel(festivalTimeZone, nowMs);

  // P1-5 — festival lifecycle phase (pre / live / post), derived from the
  // festival's date range vs now (shared `festivalPhase` → `festivalStatus`).
  // Drives the phase-aware home action band below; null when the festival has no
  // usable dates, in which case the band is hidden (phase-neutral fallback).
  const phase = useMemo(() => festivalPhase(currentFestival, days), [currentFestival, days]);

  // The person's remembered view for this festival wins; otherwise Timeline on a
  // live day with timed sets, Cards. A stored 'grid' never reaches here because
  // Grid is a pushed route that is not remembered.
  const viewMode: 'cards' | 'timeline' =
    scheduleView === 'cards' || scheduleView === 'timeline'
      ? scheduleView
      : defaultScheduleView({ hasTimedSets: festivalHasTimedSets, phase });
  const picks = currentProfile?.picks;
  const canFilterMine = hasAnyPick(picks);
  const mineActive = onlyMine && canFilterMine;
  const stageFilterActive = isStageFilterActive(activeStages, stages.length);
  const visibleDays = visibleDayIndexes(days.length, hiddenDays, selectedDay);

  // Day + stage + My picks + search filtering lives in the shared hook
  // (getFilteredSets). We then apply the same hotness → time → name sort the web
  // Cards view uses.
  const filteredSets = useMemo(() => {
    return [...getFilteredSets()].sort((a, b) => {
      const hotA = getSetHotness(a);
      const hotB = getSetHotness(b);
      if (hotA > 0 || hotB > 0) return hotB - hotA;

      const byTime = byStartTime(a, b);
      if (byTime !== 0) return byTime;

      return artistDisplayName(a, currentFestival?.b2bSeparator).localeCompare(
        artistDisplayName(b, currentFestival?.b2bSeparator),
        undefined,
        { sensitivity: 'base' },
      );
    });
    // getFilteredSets is recreated when day/stage/My picks/search/sets change.
  }, [getFilteredSets, currentFestival?.b2bSeparator]);

  // Search spans every day: matches on days other than the selected one, plus the
  // first other day that has any sets (the empty states' "Show another day").
  const otherDayGroups = useMemo(
    () => (searchQuery.trim() ? searchOtherDays(allSets, searchQuery, selectedDay, stages) : []),
    [allSets, searchQuery, selectedDay, stages],
  );
  const otherDayWithSets = useMemo(
    () => days.find((d) => d.index !== selectedDay && allSets.some((s) => s.dayIndex === d.index))?.index,
    [days, allSets, selectedDay],
  );
  const selectedDayInfo = days.find((d) => d.index === selectedDay);
  const selectedDayLabel = selectedDayInfo?.label ?? selectedDayInfo?.date;
  const otherDayMatches = (
    <OtherDayMatches
      groups={otherDayGroups}
      days={days}
      getStageName={getStageName}
      b2bSeparator={currentFestival?.b2bSeparator}
      onSelectDay={setSelectedDay}
    />
  );
  const showAnotherDayAction =
    otherDayWithSets !== undefined
      ? { label: 'Show another day', onPress: () => setSelectedDay(otherDayWithSets) }
      : undefined;

  // Conflict set IDs — same util the web Cards view uses.
  const conflictIds = useMemo(() => getConflictingSetIds(filteredSets, getMyPick), [filteredSets, getMyPick]);

  // Cards view: a header row per "Group by" section (Time, Stage or A-Z), then its sets.
  const rows = useMemo<ListRow[]>(
    () =>
      groupScheduleSets(filteredSets, groupBy, stages, currentFestival?.b2bSeparator).flatMap((g) => [
        {
          kind: 'groupHeader' as const,
          key: `group-${g.key}`,
          label: g.label,
          stageColor:
            groupBy === 'stage' && g.key ? safeStageColor(getStageColor(g.key), t.colors.text.muted) : undefined,
        },
        ...g.sets.map((set) => ({ kind: 'set' as const, key: set.id, set })),
      ]),
    [filteredSets, groupBy, stages, currentFestival?.b2bSeparator, getStageColor, t.colors.text.muted],
  );

  // Timeline/Grid views consume the same day-filtered set list (filteredSets
  // already applies day + active-stage + search), split into timed vs. TBA and
  // bounded by the day's earliest start / latest end — mirroring the web
  // useTimelineFilters logic, adapted to mobile's stores.
  const timedSets = useMemo(() => filteredSets.filter((s) => s.startTime && s.endTime), [filteredSets]);

  const timelessSets = useMemo(
    () =>
      filteredSets
        .filter((s) => !s.startTime || !s.endTime)
        .sort((a, b) =>
          artistDisplayName(a, currentFestival?.b2bSeparator).localeCompare(
            artistDisplayName(b, currentFestival?.b2bSeparator),
            undefined,
            { sensitivity: 'base' },
          ),
        ),
    [filteredSets, currentFestival?.b2bSeparator],
  );

  const timeBounds = useMemo<TimeBounds | null>(() => {
    if (timedSets.length === 0) return null;
    let minMin = 24 * 60;
    let maxMin = 0;
    for (const s of timedSets) {
      const { start, end } = setMinuteRange(s)!;
      if (start < minMin) minMin = start;
      if (end > maxMin) maxMin = end;
    }
    minMin = Math.floor(minMin / SLOT_MINUTES) * SLOT_MINUTES;
    maxMin = Math.ceil(maxMin / SLOT_MINUTES) * SLOT_MINUTES;
    return { minMin, maxMin, totalSlots: (maxMin - minMin) / SLOT_MINUTES };
  }, [timedSets]);

  // Active stages (all when none/empty), preserving the festival's stage order.
  const visibleStages = useMemo(() => {
    if (!activeStages || activeStages.length === 0) return stages;
    return stages.filter((st) => activeStages.includes(st.id));
  }, [stages, activeStages]);

  // Stage chips are tap-to-show-only, the same model as web (shared toggleStageFilter).
  const allStageIds = useMemo(() => stages.map((st) => st.id), [stages]);

  const handlePickChange = useCallback(
    (setId: string, priority: Priority | null) => {
      if (!currentFestival) return;
      if (!currentProfile) {
        router.push(user ? `/set/${setId}` : '/(auth)/login');
        return;
      }
      // The card shows the Retry chip on failure.
      savePick(currentFestival.id, setId, priority).catch(() => haptics.warning());
    },
    [currentFestival, currentProfile, user, router, savePick, haptics],
  );

  // One-tap reset for every active schedule filter (search text, my-picks, stage
  // selection) — the recoverability companion to the results summary chip.
  const clearAllFilters = useCallback(() => {
    haptics.select();
    setSearchQuery('');
    setOnlyMine(false);
    setActiveStages([]);
  }, [haptics, setSearchQuery, setOnlyMine, setActiveStages]);

  // Cards scroll tracking: reveal the scroll-to-top FAB once the user is well
  // past the fold. Guarded so the setState only fires on an actual transition.
  const handleCardsScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    setShowScrollTop((prev) => {
      const next = y > 640;
      return prev === next ? prev : next;
    });
  }, []);

  const scrollCardsToTop = useCallback(() => {
    haptics.select();
    listRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotion });
    setShowScrollTop(false);
  }, [haptics, reduceMotion]);

  const renderRow = useCallback<ListRenderItem<ListRow>>(
    ({ item }) => {
      if (item.kind === 'groupHeader') {
        return (
          <View style={styles.stageHeader} accessibilityRole="header">
            {item.stageColor ? <View style={[styles.stageDot, { backgroundColor: item.stageColor }]} /> : null}
            <Text style={styles.stageHeaderText} numberOfLines={1}>
              {item.label}
            </Text>
          </View>
        );
      }
      const set = item.set;
      return (
        <SetCardMobile
          set={set}
          stageName={getStageName(set.stageId) || 'Unknown'}
          stageColor={safeStageColor(getStageColor(set.stageId), t.colors.text.muted)}
          myPick={getMyPick(set.id)}
          friendProfiles={getOtherPicks(set.id)}
          hasConflict={conflictIds.has(set.id)}
          hasNote={!!getMyNote(set.id)}
          onPickChange={(priority) => handlePickChange(set.id, priority)}
          onPress={() => router.push(`/set/${set.id}`)}
        />
      );
    },
    [
      styles,
      getStageName,
      getStageColor,
      getMyPick,
      getOtherPicks,
      getMyNote,
      conflictIds,
      handlePickChange,
      router,
      t.colors.text.muted,
    ],
  );

  const keyExtractor = useCallback((item: ListRow) => item.key, []);

  // Stable separator so FlatList doesn't recreate it on every render.
  const cardsSeparator = useCallback(() => <View style={styles.separator} />, [styles.separator]);

  // Stage color resolver that substitutes a real token for web's `var(...)`
  // fallback so the timeline/grid views never receive an unparseable color.
  const resolveStageColor = useCallback(
    (stageId: string) => safeStageColor(getStageColor(stageId), t.colors.text.muted),
    [getStageColor, t.colors.text.muted],
  );

  const handleSetPress = useCallback((set: FestivalSet) => router.push(`/set/${set.id}`), [router]);

  // Shared TBA section, reused as a footer across all three views.
  const tbaSection =
    timelessSets.length > 0 ? (
      <TBASection
        sets={timelessSets}
        stages={stages}
        currentProfile={currentProfile}
        currentFestival={currentFestival}
        getMyPick={getMyPick}
        getOtherPicks={getOtherPicks}
        getStageColor={resolveStageColor}
        onSavePick={handlePickChange}
        onOpenDetail={handleSetPress}
        defaultExpanded={timedSets.length === 0}
      />
    ) : null;

  // F2 — when the selected festival failed to load (flaky wifi refresh, cold
  // restore, server 500) `sets` stays empty; surface the real error + a retry
  // instead of the misleading "No sets for this day" empty state. Mirrors the
  // Picks tab's error ladder. Only kicks in when we genuinely have no sets to
  // show — a populated cache still renders normally even if a refetch errored.
  const scheduleLoadError = error && allSets.length === 0 ? error : null;

  // COLD LOAD: fetching with nothing cached to show. Without this the flagship
  // tab announces "No sets for this day" — and offers to switch festivals —
  // while the day's sets are still in flight on slow signal. Gated exactly like
  // the Picks tab's PicksSkeleton branch (isLoading AND nothing on screen), so
  // a pull-to-refresh over existing sets never flashes a skeleton.
  const scheduleColdLoading = isLoading && allSets.length === 0 && rows.length === 0;

  const errorScheduleState = (
    <EmptyState
      icon="cloud-offline-outline"
      title="Couldn’t load the schedule"
      message={scheduleLoadError ?? ''}
      action={{
        label: 'Try again',
        onPress: () => {
          if (currentFestival) selectFestival(currentFestival.id).catch(() => {});
        },
      }}
    />
  );

  // Search found nothing on the selected day. A selected-day match hidden by the
  // stage or my-picks filter says so; a match on another day lists those days;
  // otherwise the artist is not in the lineup.
  const searchHidden = searchHiddenByFilters(
    allSets.filter((s) => s.dayIndex === selectedDay),
    searchQuery,
    stages,
  );
  const searchCopy = searchEmptyCopy(
    searchQuery,
    selectedDayLabel ?? 'this day',
    otherDayGroups.length > 0,
    searchHidden,
  );
  const searchEmptyState = (
    <>
      <EmptyState
        icon="search"
        title={searchCopy.title}
        message={searchCopy.message}
        action={
          searchHidden
            ? {
                label: searchCopy.actionLabel,
                onPress: () => {
                  setOnlyMine(false);
                  setActiveStages([]);
                },
              }
            : { label: searchCopy.actionLabel, onPress: () => setSearchQuery('') }
        }
      />
      {otherDayMatches}
    </>
  );

  // The empty list blames the filter that caused it (search, then My picks, then
  // the stage filter) and offers the button that undoes it. Only an empty day
  // falls through to the day copy below.
  const emptyReason = scheduleEmptyReason({
    query: searchQuery,
    onlyMine,
    hasAnyPick: canFilterMine,
    stageFilterActive,
  });
  const filterEmptyState = (reason: 'picks' | 'stages') => {
    const copy = scheduleEmptyCopy(reason, selectedDayLabel ?? 'this day');
    const undo = reason === 'picks' ? () => setOnlyMine(false) : () => setActiveStages([]);
    return (
      <EmptyState
        icon={reason === 'picks' ? 'star-outline' : 'filter-outline'}
        title={copy.title}
        message={copy.message}
        action={copy.actionLabel ? { label: copy.actionLabel, onPress: undo } : undefined}
      />
    );
  };

  // A filtered-out day still HAS sets, so the filter is blamed instead of the
  // false "No sets for this day". The timeless-sets hint still wins when the day
  // has TBA sets (timelessSets non-empty).
  const emptyScheduleState =
    emptyReason === 'search' ? (
      searchEmptyState
    ) : (emptyReason === 'picks' || emptyReason === 'stages') && timelessSets.length === 0 ? (
      filterEmptyState(emptyReason)
    ) : (
      <EmptyState
        icon="musical-notes"
        title={timelessSets.length > 0 ? 'Set times not announced yet' : 'No sets for this day'}
        message={
          timelessSets.length > 0
            ? 'This day’s set times haven’t been posted. Browse the full lineup in the TBA list below, or switch to Cards.'
            : 'Pick another day from the day selector to browse the schedule.'
        }
        action={
          timelessSets.length > 0
            ? { label: 'Show Cards', onPress: () => setScheduleView('cards') }
            : showAnotherDayAction
        }
      />
    );

  // Cards-view empty element. Layers the honest cases: a failed load (error +
  // retry), the filter that emptied the day, and the plain empty-day state.
  const cardsEmpty = scheduleColdLoading ? (
    // The FlatList's contentContainerStyle already applies hPad here.
    <ScheduleSkeleton />
  ) : scheduleLoadError ? (
    errorScheduleState
  ) : emptyReason === 'search' ? (
    searchEmptyState
  ) : emptyReason === 'picks' || emptyReason === 'stages' ? (
    filterEmptyState(emptyReason)
  ) : (
    <EmptyState
      icon="musical-notes"
      title="No sets for this day"
      message="Pick another day from the day selector to browse the schedule."
      action={showAnotherDayAction}
    />
  );

  // No festival selected — show the festival selector. FestivalList owns its own
  // loading (skeleton), error, and empty states (F21); the screen no longer
  // pre-empts them with a separate spinner/EmptyState, which produced two
  // different-looking treatments for the identical condition.
  if (!currentFestival || pickingFestival) {
    return (
      // ScreenHeader owns the top safe-area inset (insets.top + spacing[4]) — the
      // native Tabs nav header is hidden (see (tabs)/_layout.tsx), so this is the
      // single top of the screen.
      <View style={styles.container}>
        <ScreenHeader
          title="Select a Festival"
          icon="musical-notes"
          right={
            pickingFestival && currentFestival ? (
              <TouchableOpacity
                style={styles.headerIconButton}
                onPress={() => setPickingFestival(false)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Back to ${currentFestival.name}`}
              >
                <Ionicons name="close" size={20} color={t.colors.text.secondary} />
              </TouchableOpacity>
            ) : undefined
          }
        />
        {pickingFestival && offlineMode ? (
          <Text style={styles.pickerOffline} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            You&apos;re offline. Switching festivals needs signal. Your current lineup stays saved.
          </Text>
        ) : null}
        <FestivalList onSelected={() => setPickingFestival(false)} />
      </View>
    );
  }

  // DC1 — a filter is "active" when it's currently hiding/altering rows. The
  // search and filter panels stay forced-open while their state is active so a
  // user can always see (and clear) a filter that's shrinking the schedule,
  // even though both default to collapsed.
  // Hidden days are a preference, not a filter, so they never force the panel open.
  const filtersActive = mineActive || stageFilterActive;
  const searchOpen = showSearch || searchQuery.length > 0;
  const filtersOpen = showFilters || filtersActive;
  // Any narrowing in effect (search OR my-picks OR a stage subset) — gates the
  // results-summary + Clear-all chip.
  const anyFilterActive = searchQuery.trim() !== '' || filtersActive;

  // Schedule controls (Now & Next, phase actions, search, day + stage filters).
  // In Cards view these ride in the FlatList's ListHeaderComponent so the WHOLE
  // page scrolls as one — the cards get full height instead of a small window
  // pinned under a tall fixed chrome stack. In Timeline view they stay fixed
  // above the bounded 2D timeline (which manages its own internal scroll).
  // Passed as an element (not an inline component) so the search TextInput keeps
  // focus across keystroke re-renders.
  const controls = (
    <>
      {/* Phase shortcuts: always on tablets, after the festival on phones. They
          ride in the controls so they scroll with the Cards list. The close
          button hides them for this festival and phase. */}
      {user && phase && dismissedPhase !== phase && (isTablet || phase === 'post') ? (
        <View style={{ paddingHorizontal: hPad }}>
          <PhaseHomeActions phase={phase} onDismiss={() => dismissPhaseBand(phase)} />
        </View>
      ) : null}

      {/* Live-day Now & Next surface: shows the picked set playing now / up next
          inline, tapping through to the full Now & Next screen. Renders nothing
          when there's no current/upcoming pick. */}
      <View style={{ paddingHorizontal: hPad }}>
        <NowNextStrip onPress={() => router.push('/festival-mode')} />
      </View>

      {/* F19 — offline-honest freshness for the flagship schedule surface,
          matching the crew tab's chip. Driven by festivalDataStore's
          _festivalCachedAt; renders nothing until the schedule is cached once. */}
      <View style={[styles.freshnessRow, { paddingHorizontal: hPad }]}>
        <FreshnessChip surface="schedule" />
        {currentProfile ? <SaveStatusChip /> : null}
        {/* Cards and fallback views support pull-to-refresh. Timeline owns both
            scroll axes, so narrow phones need this compact manual action after
            the header sheds secondary icons to preserve the festival title. */}
        {width < 400 && viewMode === 'timeline' ? (
          <TouchableOpacity
            style={styles.compactRefreshButton}
            onPress={handleRefresh}
            disabled={isLoading}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Refresh schedule"
            accessibilityState={{ busy: isLoading }}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={t.colors.accent.aqua} />
            ) : (
              <Ionicons name="refresh" size={18} color={t.colors.accent.aqua} />
            )}
          </TouchableOpacity>
        ) : null}
      </View>

      {/* DC1 — search and the stage / my-picks + phase-action setup chrome are
          folded behind the search/filter toggles in the control row above; only
          the day chips (the one mid-festival control) stay always visible. The
          panels expand inline here when toggled (or when they carry active
          state), so on small phones the timeline keeps ~70% of the viewport. */}
      {searchOpen ? (
        <View style={[styles.searchRow, { marginHorizontal: hPad }]}>
          <Ionicons name="search" size={16} color={t.colors.text.placeholder} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search artists or stages"
            placeholderTextColor={t.colors.text.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={showSearch && searchQuery.length === 0}
            accessibilityLabel="Search the lineup"
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={13}
            >
              <Ionicons name="close-circle" size={18} color={t.colors.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Day selector */}
      <ScheduleDayChips hPad={hPad} />
      {days.length > 1 && zoneLabel ? (
        <Text style={[styles.zoneLabel, { paddingHorizontal: hPad }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {zoneLabel}
        </Text>
      ) : null}

      {/* Stage + my-picks filters, then the days the person attends — folded
          behind the filter toggle (DC1). */}
      {filtersOpen && (currentProfile || stages.length > 1 || days.length > 1) ? (
        <View style={styles.filterRow}>
          {currentProfile || stages.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.filterContent, { paddingHorizontal: hPad }]}
              // Android-native right-edge fade — signals scrollable overflow without
              // requiring expo-linear-gradient. No-op on iOS (ignored silently).
              fadingEdgeLength={Platform.OS === 'android' ? 32 : 0}
            >
              {currentProfile ? (
                // R3 single-accent-fill-per-screen: the SegmentedControl already
                // holds the solid-aqua primary fill. The My picks chip uses the
                // outlined/tinted secondary variant (aqua border + aqua text on
                // transparent bg) so two solid aqua fills never appear together.
                // With no picks it is muted and inert so it can never blank the lineup.
                <TouchableOpacity
                  style={[
                    styles.filterChip,
                    !canFilterMine && styles.filterChipMuted,
                    mineActive && styles.filterChipActiveTinted,
                  ]}
                  onPress={canFilterMine ? () => setOnlyMine(!onlyMine) : undefined}
                  activeOpacity={canFilterMine ? 0.7 : 1}
                  accessibilityRole="button"
                  accessibilityState={canFilterMine ? { selected: onlyMine } : { disabled: true, selected: false }}
                  accessibilityLabel="Show only my picks"
                >
                  <Ionicons name="star" size={12} color={mineActive ? t.colors.accent.aqua : t.colors.text.muted} />
                  <Text
                    style={[
                      styles.filterChipText,
                      !canFilterMine && styles.filterChipTextMuted,
                      mineActive && styles.filterChipTextTinted,
                    ]}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                  >
                    {canFilterMine ? 'My picks' : 'Pick a set first'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {stages.length > 1 ? (
                <>
                  <TouchableOpacity
                    style={[styles.filterChip, activeStages.length === 0 && styles.filterChipActiveTinted]}
                    onPress={() => {
                      haptics.select();
                      setActiveStages([]);
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: activeStages.length === 0 }}
                    accessibilityLabel="All stages"
                  >
                    <Text
                      style={[styles.filterChipText, activeStages.length === 0 && styles.filterChipTextTinted]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                    >
                      All stages
                    </Text>
                  </TouchableOpacity>
                  {stages.map((st) => {
                    const on = activeStages.includes(st.id);
                    // Stage dots keep their data-driven identity color (matching the
                    // timeline columns) — the accent rule governs UI accents, not the
                    // stage palette.
                    return (
                      <TouchableOpacity
                        key={st.id}
                        style={[styles.filterChip, on && styles.filterChipActiveTinted]}
                        onPress={() => {
                          haptics.select();
                          setActiveStages(toggleStageFilter(activeStages, allStageIds, st.id));
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={st.name}
                      >
                        <View style={[styles.stageDotSmall, { backgroundColor: resolveStageColor(st.id) }]} />
                        <Text
                          style={[styles.filterChipText, on && styles.filterChipTextTinted]}
                          numberOfLines={1}
                          maxFontSizeMultiplier={MAX_FONT_SCALE}
                        >
                          {st.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </>
              ) : null}
            </ScrollView>
          ) : null}
          {days.length > 1 ? (
            <>
              <Text style={[styles.daysGoingLabel, { paddingHorizontal: hPad }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Days I&apos;m going
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.filterContent, { paddingHorizontal: hPad }]}
              >
                {days.map((day) => {
                  const shown = !hiddenDays.includes(day.index);
                  const onlyShown = shown && visibleDays.length === 1;
                  return (
                    <TouchableOpacity
                      key={day.index}
                      style={[styles.filterChip, shown && styles.filterChipActiveTinted]}
                      onPress={() => {
                        haptics.select();
                        setHiddenDays(toggleHiddenDay(hiddenDays, days.length, day.index));
                      }}
                      disabled={onlyShown}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={onlyShown ? { selected: shown, disabled: true } : { selected: shown }}
                      accessibilityLabel={day.label ?? day.date}
                    >
                      <Text
                        style={[styles.filterChipText, shown && styles.filterChipTextTinted]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                      >
                        {day.label ?? day.date}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          ) : null}
        </View>
      ) : null}

      {/* Results summary + Clear-all. Surfaces honestly how many sets the active
          search/stage/my-picks filters resolve to, and gives a single recovery
          tap when a filter is hiding most of the lineup. Only shown while a
          filter is actually narrowing the list. In Timeline mode the count spans
          the whole filtered day but only timed sets are plotted, so the TBA
          count qualifies the number. */}
      {anyFilterActive ? (
        <ScheduleResultsRow
          summary={scheduleResultsSummary({
            count: filteredSets.length,
            onlyMine: mineActive,
            activeStageCount: stageFilterActive ? activeStages.length : 0,
            tbaCount: viewMode === 'timeline' ? timelessSets.length : 0,
          })}
          onClearAll={clearAllFilters}
          hPad={hPad}
        />
      ) : null}
    </>
  );

  // DC1 (Option C) — the Switch + Now&Next actions move into the header's
  // trailing slot, collapsing the former standalone live row. The pulsing
  // LiveDot stays in the control row below as the now indicator.
  const headerActions = (
    <View style={styles.headerActions}>
      {/* Manual refresh for ALL views — the RefreshControls only cover the Cards
          list + fallback scroll, leaving Timeline with no pull-to-refresh. */}
      {/* Cards has pull-to-refresh, so the button only shows in Timeline. */}
      {width >= 400 && viewMode === 'timeline' ? (
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={handleRefresh}
          disabled={isLoading}
          activeOpacity={0.7}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Refresh schedule"
          accessibilityState={{ busy: isLoading }}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={t.colors.accent.aqua} />
          ) : (
            <Ionicons name="refresh" size={t.iconSize.lg} color={t.colors.accent.aqua} />
          )}
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={[styles.headerIconButton, styles.headerSwitchButton]}
        onPress={() => setPickingFestival(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Switch festival"
      >
        <Ionicons name="swap-horizontal" size={20} color={t.colors.text.secondary} />
        <Text style={styles.headerSwitchText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Switch
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.headerIconButton}
        onPress={() => router.push('/festival-mode')}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Open Now and Next"
      >
        {/* "Live" is reserved for location (P1-2); flash = Now & Next. */}
        <Ionicons name="flash" size={20} color={t.colors.accent.aqua} />
      </TouchableOpacity>
    </View>
  );

  return (
    // ScreenHeader owns the top safe-area inset (insets.top + spacing[4]) — the
    // native Tabs nav header is hidden (see (tabs)/_layout.tsx), so this is the
    // single top of the screen, sitting above the consolidated control row.
    <View style={styles.container} testID="schedule-screen">
      <ScreenHeader title={currentFestival.name} icon="calendar-outline" right={headerActions} />
      {/* DC1 — one consolidated control row: LiveDot now-indicator, the
          view switcher, and the search/filter toggles. The search bar and the
          stage/phase filters fold inline below (in `controls`) only when their
          toggle is on or they carry active state, reclaiming vertical space. */}
      <View style={[styles.viewSwitcher, { paddingHorizontal: hPad }]}>
        {/* No now-indicator here: it crowded the row and truncated the
            Timeline/Cards labels on narrow phones. The real now/next surface is
            NowNextStrip above (shown only when a pick is actually live). */}
        <View style={styles.switcherFlex}>
          <SegmentedControl
            options={festivalHasTimedSets ? VIEW_OPTIONS_WITH_GRID : VIEW_OPTIONS}
            value={viewMode}
            onChange={(next: ScheduleView) => (next === 'grid' ? router.push('/grid') : setScheduleView(next))}
            accessibilityLabel="Schedule view"
          />
        </View>
        <TouchableOpacity
          style={[styles.toggleButton, searchOpen && styles.toggleButtonActive]}
          // searchOpen stays true while a query is present (searchOpen = showSearch
          // || search.length > 0), so merely toggling showSearch can't close an
          // active search — the panel re-opens itself. Closing must also CLEAR the
          // query so the X reliably collapses the bar.
          onPress={() => {
            if (searchOpen) {
              setSearchQuery('');
              setShowSearch(false);
            } else {
              setShowSearch(true);
            }
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: searchOpen }}
          accessibilityLabel={searchOpen ? 'Hide search' : 'Search the lineup'}
        >
          {/* When the search bar is open a search icon inside the field already
              serves as the affordance — switch the header trigger to a close icon
              so the two search icons don't appear simultaneously on screen. */}
          <Ionicons
            name={searchOpen ? 'close' : 'search'}
            size={18}
            color={searchOpen ? t.colors.accent.aqua : t.colors.text.secondary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, filtersOpen && styles.toggleButtonActive]}
          onPress={() => setShowFilters((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersOpen }}
          accessibilityLabel={filtersOpen ? 'Hide filters' : 'Show filters'}
        >
          <Ionicons
            name="options-outline"
            size={18}
            color={filtersOpen ? t.colors.accent.aqua : t.colors.text.secondary}
          />
          {filtersActive ? <View style={styles.toggleDot} /> : null}
        </TouchableOpacity>
      </View>

      {/* Schedule body — view-mode specific. In Cards view the `controls` ride
          in the FlatList's ListHeaderComponent so the WHOLE page scrolls as one
          (cards get full height); in Timeline view they stay fixed above the
          bounded 2D timeline. */}
      {viewMode === 'cards' ? (
        <>
          <FlatList
            ref={listRef}
            style={[styles.scrollBody, { marginBottom: scheduleViewportBottomInset }]}
            data={rows}
            renderItem={renderRow}
            keyExtractor={keyExtractor}
            ListHeaderComponent={
              <>
                {controls}
                {filteredSets.length > 0 ? (
                  <View style={[styles.groupByRow, { paddingHorizontal: hPad }]}>
                    <Text style={styles.groupByLabel}>Group by</Text>
                    <View style={styles.switcherFlex}>
                      <SegmentedControl
                        options={GROUP_BY_OPTIONS}
                        value={groupBy}
                        onChange={setScheduleGroupBy}
                        accessibilityLabel="Group sets by"
                      />
                    </View>
                  </View>
                ) : null}
              </>
            }
            // The controls already apply hPad themselves, so cancel the container's.
            ListHeaderComponentStyle={{ marginHorizontal: -hPad }}
            contentContainerStyle={[styles.listContent, { paddingHorizontal: hPad, paddingBottom: listBottomPad }]}
            refreshControl={refreshControl}
            ItemSeparatorComponent={cardsSeparator}
            // F2 — a failed festival load surfaces the error + retry rather than a
            // misleading "No sets" empty state (see cardsEmpty).
            ListEmptyComponent={cardsEmpty}
            ListFooterComponent={rows.length > 0 ? otherDayMatches : undefined}
            // Perf for big lineups: cap the initial + per-batch render window so a
            // 200-set day paints fast and scrolls without a long first frame.
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={11}
            onScroll={handleCardsScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentInsetAdjustmentBehavior="automatic"
          />
          {showScrollTop ? (
            <TouchableOpacity
              style={[styles.scrollTopFab, { right: hPad, bottom: t.spacing[5] + scheduleViewportBottomInset }]}
              onPress={scrollCardsToTop}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Scroll to top of the lineup"
            >
              <Ionicons name="chevron-up" size={18} color={t.colors.text.onLightAccent} />
              <Text style={styles.scrollTopText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Top
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : timeBounds && visibleStages.length > 0 ? (
        <>
          {controls}
          <View style={[styles.viewBody, { marginBottom: scheduleViewportBottomInset }]}>
            <TimelineView
              visibleStages={visibleStages}
              timedSets={timedSets}
              timeBounds={timeBounds}
              selectedDay={selectedDay}
              conflictIds={conflictIds}
              b2bSeparator={currentFestival.b2bSeparator}
              getMyPick={getMyPick}
              getStageColor={resolveStageColor}
              onPickChange={handlePickChange}
              onSetPress={handleSetPress}
              days={days}
              allSets={allSets}
              picks={currentProfile?.picks ?? null}
            />
            {/* Dock the TBA list below the timeline in its own bounded scroll so
                it's always reachable. A ScrollView with a fixed maxHeight stays
                content-sized while the section is collapsed (just its header) and,
                once expanded, caps at ~40% of the screen and scrolls internally —
                instead of ballooning and pushing itself + the timeline past
                viewBody's clipped (overflow:hidden) bottom edge, which made the
                TBA cards unreachable. */}
            {tbaSection ? <ScrollView style={{ maxHeight: Math.round(height * 0.4) }}>{tbaSection}</ScrollView> : null}
          </View>
        </>
      ) : (
        <ScrollView
          style={[styles.scrollBody, { marginBottom: scheduleViewportBottomInset }]}
          contentContainerStyle={[styles.fallbackScroll, { paddingBottom: listBottomPad }]}
          refreshControl={refreshControl}
          contentInsetAdjustmentBehavior="automatic"
        >
          {controls}
          {scheduleColdLoading ? (
            <ScheduleSkeleton hPad={hPad} />
          ) : scheduleLoadError ? (
            errorScheduleState
          ) : (
            emptyScheduleState
          )}
          {tbaSection}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Cold-load placeholder for the schedule — a stage header plus a few set-card
 * shaped rows so the layout matches what's about to render (no spinner, no
 * jump). Mirrors PicksSkeleton on the Picks tab. `hPad` is passed by callers
 * that are NOT already inside a horizontally padded container.
 */
function ScheduleSkeleton({ hPad = 0 }: { hPad?: number }) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View
      style={[styles.skeletonContent, { paddingHorizontal: hPad }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading the schedule"
    >
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

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
    // Clip to the screen frame. The schedule body's internal scroll views can
    // size to tall content; without this, on short screens (or large iOS notch
    // insets) that content overflows the frame's bottom edge and — because RN's
    // default overflow is 'visible' — paints AND intercepts touches over the
    // bottom tab bar, making tabs untappable. Clipping confines it to the body.
    overflow: 'hidden',
  },
  // DC1 — one horizontal control row: LiveDot · view switcher (flex) ·
  // search/filter toggles. Replaces the former two-line live row + switcher.
  // gap[1] (4px) instead of gap[2] (8px) recovers ~12px so both "Timeline" and
  // "Cards" labels fit without clipping on ~360dp phones (toggle targets are 44px
  // so they still comfortably meet WCAG 2.5.5 without the extra gap).
  viewSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  // minWidth:0 prevents the flex child from overflowing its flex allocation when
  // the SegmentedControl's natural content width exceeds the available space.
  switcherFlex: {
    flex: 1,
    minWidth: 0,
  },
  // DC1 (Option C) — Switch / Now&Next moved into ScreenHeader's trailing slot.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  headerIconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    // WCAG 2.5.5 / 2.5.8 minimum 44px touch target.
    minWidth: 44,
    minHeight: 44,
  },
  headerSwitchButton: {
    flexDirection: 'row',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[1],
  },
  headerSwitchText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  pickerOffline: {
    ...typeStyle('label'),
    color: t.colors.accent.amber,
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[2],
  },
  toggleButton: {
    alignItems: 'center',
    justifyContent: 'center',
    // WCAG 2.5.5 / 2.5.8 minimum 44px touch target.
    minWidth: 44,
    minHeight: 44,
    borderRadius: t.radii.default,
  },
  toggleButtonActive: {
    backgroundColor: t.colors.aquaAlpha[12],
  },
  // Active-filter affordance: a small aqua dot on the filter toggle so a
  // collapsed-but-active filter stays discoverable.
  toggleDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.accent.aqua,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    marginHorizontal: t.spacing[4],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    // border.light (0.10 alpha) instead of border.default (0.06) so the field
    // reads as an interactive text input and is not confused with the card
    // surfaces (same #1a1a1a bg) that lack a distinguishing border.
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  searchIcon: {
    marginRight: 0,
  },
  searchInput: {
    flex: 1,
    ...typeStyle('body'),
    color: t.colors.text.primary,
    padding: 0,
  },
  freshnessRow: {
    paddingTop: t.spacing[2],
  },
  compactRefreshButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
  },
  // Scroll-to-top FAB (cards view, long lineups). Aqua pill with dark ink to
  // match the timeline's Now FAB; sits above the tab bar, right-aligned.
  scrollTopFab: {
    position: 'absolute',
    bottom: t.spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
    minHeight: 44,
    // Lift the pill above the surface so it reads as floating over the list.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  scrollTopText: {
    ...typeStyle('label', 700),
    color: t.colors.text.onLightAccent,
  },
  zoneLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    marginTop: t.spacing[1],
  },
  filterRow: {
    paddingBottom: t.spacing[2],
  },
  filterContent: {
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    // WCAG 2.5.5 / 2.5.8 minimum 44x44px touch target (motor accessibility).
    minHeight: 44,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  // R3 outlined-secondary variant for the "My picks" chip. The SegmentedControl
  // already holds the solid-aqua primary fill; a second solid aqua fill (the
  // old filterChipActive) violates the single-accent-fill-per-screen rule.
  // Outlined tint (aqua border + tinted bg, no solid fill) is the correct
  // secondary treatment for a non-primary toggle alongside a primary control.
  filterChipActiveTinted: {
    backgroundColor: t.colors.aquaAlpha[12],
    borderColor: t.colors.aquaAlpha[70],
  },
  // Inert "Pick a set first" chip: recessed background + lighter border, with a
  // muted label, so it reads as unavailable without relying on opacity.
  filterChipMuted: {
    backgroundColor: t.colors.bg.primary,
    borderColor: t.colors.border.light,
  },
  filterChipText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  // Companion text style for the outlined-tinted chip variant (My picks).
  filterChipTextTinted: {
    color: t.colors.accent.aqua,
  },
  filterChipTextMuted: {
    color: t.colors.text.muted,
  },
  daysGoingLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingTop: t.spacing[2],
  },
  stageDotSmall: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingTop: t.spacing[2],
    paddingBottom: t.spacing[1],
  },
  stageDot: {
    width: 10,
    height: 10,
    borderRadius: t.radii.pill,
  },
  stageHeaderText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  groupByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingTop: t.spacing[2],
  },
  groupByLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  listContent: {
    padding: t.spacing[4],
    paddingTop: t.spacing[2],
    flexGrow: 1,
  },
  separator: {
    height: t.spacing[3],
  },
  // flex:1 binds the cards FlatList / fallback ScrollView to the (overflow-clipped)
  // container so they scroll internally up to the tab bar instead of sizing to
  // content and being clipped.
  scrollBody: {
    flex: 1,
  },
  viewBody: {
    flex: 1,
    // Bound the timeline to the body so its internal scroll never bleeds over
    // the tab bar (see container note).
    overflow: 'hidden',
  },
  fallbackScroll: {
    flexGrow: 1,
    paddingBottom: t.spacing[4],
  },
  // ── Cold-load skeleton (geometry shared with the Picks tab) ───────────────
  skeletonContent: {
    paddingTop: t.spacing[2],
  },
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
}));
