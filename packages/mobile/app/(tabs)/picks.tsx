import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Share,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useAuthStore,
  useCrewStore,
  useFestivalDataStore,
  useUIStore,
  selectMyPicks,
} from '@festie/shared/stores';
import { usePicks, useFestival, usePicksPlan, usePickClear, useBulkAddPicks } from '@festie/shared/hooks';
import type { FestivalSet, Priority } from '@festie/shared/types';
import {
  artistDisplayName,
  buildBulkPickGroups,
  type PicksRow,
  type PicksFilter,
  type PicksGroupMode,
  type PicksOrder,
  type PlanListItem,
  type PlanListKind,
  buildListenList,
  listenListText,
  buildMyDay,
  buildPlanList,
  filterPickMap,
  filterPlanListItems,
  isSetScheduled,
  clashBadgeBySetId,
  fmtZonedClock,
  spotifyAttributionFor,
} from '@festie/shared/utils';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { COPY, clashCount } from '@festie/shared/constants';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useHaptics } from '../../hooks/useHaptics';
import { duration as motionDuration } from '@festie/shared/tokens';
import { safeStageColor } from '../../lib/stageColor';
import { priorityColor } from '../../lib/priorityColor';
import { undoNotifier } from '../../lib/undoNotifier';
import { CONCEPT_IONICON } from '../../lib/conceptIcons';
import ScreenHeader from '../../components/ScreenHeader';
import EmptyState from '../../components/EmptyState';
import SetCardMobile from '../../components/SetCardMobile';
import { WalkRow, GapRow, MeetRow, PlanListRow } from '../../components/PlanRows';
import { usePicksCalendar } from '../../hooks/usePicksCalendar';
import PicksCalendarButton from '../../components/picks/PicksCalendarButton';
import PicksListenSection from '../../components/picks/PicksListenSection';
import PicksSummaryRow from '../../components/picks/PicksSummaryRow';
import PicksControlsRow from '../../components/picks/PicksControlsRow';
import PicksOrderRow from '../../components/picks/PicksOrderRow';
import PicksSearchField from '../../components/picks/PicksSearchField';
import PicksBulkPanel from '../../components/picks/PicksBulkPanel';
import PicksHeader from '../../components/picks/PicksHeader';
import PicksNoFestivalState from '../../components/picks/PicksNoFestivalState';
import Separator from '../../components/picks/Separator';
import PicksSkeleton from '../../components/picks/PicksSkeleton';
import { useStyles } from '../../components/picks/styles';

/**
 * A flattened list row: a collapsible group header, a sub-group header, or a
 * picked set. One FlatList (rather than nested .map in a ScrollView) keeps list
 * virtualization across the whole picks plan. Built by the shared usePicksPlan.
 */
type Row =
  | PicksRow
  | { kind: 'walk'; key: string; minutes: number; fromStage: string }
  | { kind: 'gap'; key: string; minutes: number }
  | { kind: 'meet'; key: string; label: string; location: string; timeLabel: string }
  | { kind: 'planItem'; key: string; item: PlanListItem; listKind: PlanListKind };

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
  const myPicks = useFestivalDataStore(selectMyPicks);
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
  const festivals = useFestivalDataStore((s) => s.festivals);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);

  // A cold start can land here before any screen loaded the catalogue; without this the loading state never resolves.
  useEffect(() => {
    // Read the load flags at fire time: depending on them re-fires this after every load, and an empty catalogue never stops.
    const { isLoading: loading, error: loadError } = useFestivalDataStore.getState();
    if (!currentFestival && festivals.length === 0 && !loading && !loadError) {
      loadFestivals().catch(() => {});
    }
  }, [currentFestival, festivals.length, loadFestivals]);

  const { exportBusy, handleAddToCalendar } = usePicksCalendar();
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
  const [listenOpen, setListenOpen] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);
  // The clash chip on the schedule opens this tab with show=clashes.
  const { show } = useLocalSearchParams<{ show?: string }>();
  const [clashY, setClashY] = useState<number | null>(null);
  useEffect(() => {
    if (show !== 'clashes' || clashY === null) return;
    listRef.current?.scrollToOffset({ offset: clashY, animated: !reduceMotion });
    AccessibilityInfo.announceForAccessibility(
      conflictGroups.length ? clashCount(conflictGroups.length) : COPY.clash.none,
    );
    router.setParams({ show: undefined });
  }, [show, clashY, reduceMotion, conflictGroups.length, router]);

  const { getMyPick, savePick, getMyNote, getMyReminder } = usePicks();
  const { getDays, getStageColor, getStageName } = useFestival();
  const clearPick = usePickClear(undoNotifier);
  const { busyKey: bulkBusyKey, add: bulkAdd } = useBulkAddPicks(undoNotifier);

  const days = useMemo(() => getDays(), [getDays]);
  const conflictIds = plan.clashIds;
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const festivalTimeZone = currentFestival?.timeZone;
  const separator = currentFestival?.b2bSeparator;
  // My day replaces the day/priority grouping; a plan list replaces the whole plan.
  const [myDayMode, setMyDayMode] = useState(false);
  const [planList, setPlanList] = useState<PlanListKind | null>(null);

  const clashBadges = useMemo(
    () => clashBadgeBySetId(conflictGroups.flatMap((g) => g.pairs), separator),
    [conflictGroups, separator],
  );

  const myNotes = currentProfile?.notes;
  const myReminders = currentProfile?.reminders;
  const planListInput = useMemo(
    () => ({ sets, days: storeDays, timeZone: festivalTimeZone, notes: myNotes, reminders: myReminders, myPicks: myPicks ?? undefined }),
    [sets, storeDays, festivalTimeZone, myNotes, myReminders, myPicks],
  );
  const reminderItems = useMemo(() => buildPlanList('reminders', planListInput), [planListInput]);
  const noteItems = useMemo(() => buildPlanList('notes', planListInput), [planListInput]);
  // A list that empties (last note removed) falls back to the plan instead of stranding the user.
  const activePlanList =
    planList === 'reminders' && reminderItems.length > 0
      ? 'reminders'
      : planList === 'notes' && noteItems.length > 0
        ? 'notes'
        : null;

  const listRows = useMemo<Row[]>(() => {
    if (activePlanList) {
      const items = filterPlanListItems(activePlanList === 'reminders' ? reminderItems : noteItems, search, stages);
      const out: Row[] = [];
      const known = new Set(days.map((d) => d.index));
      const emit = (groupId: string, label: string, groupItems: PlanListItem[]) => {
        if (groupItems.length === 0) return;
        const collapsed = plan.collapsed.has(groupId);
        out.push({ kind: 'group', key: `g-${groupId}`, groupId, label, count: groupItems.length, collapsed });
        if (collapsed) return;
        groupItems.forEach((item) =>
          out.push({ kind: 'planItem', key: `plan-${activePlanList}-${item.set.id}`, item, listKind: activePlanList }),
        );
      };
      days.forEach((day) => emit(`day-${day.index}`, day.label || day.date, items.filter((i) => i.dayIndex === day.index)));
      emit('day-tba', 'Unscheduled', items.filter((i) => i.dayIndex == null || !known.has(i.dayIndex)));
      return out;
    }
    if (!myDayMode) return rows;

    // My day covers the picks the current filter and search leave in the plan.
    // Membership ignores collapsed groups in By day / By priority, which emit only their header.
    const visiblePicks = filterPickMap({
      sets,
      picks: myPicks ?? undefined,
      stages,
      filter: effectiveFilter,
      search,
      clashIds: conflictIds,
    });
    const out: Row[] = [];
    days.forEach((day) => {
      const myDay = buildMyDay({
        sets,
        myPicks: visiblePicks,
        dayIndex: day.index,
        days: storeDays,
        timeZone: festivalTimeZone,
        stages,
        meetingPoints,
        conflictGroups,
        b2bSeparator: separator,
      });
      // buildMyDay lists picks with no known day as unscheduled on every day; keep this day's own.
      const dayUnscheduled = myDay.unscheduled.filter((s) => s.dayIndex === day.index);
      if (myDay.sections.length === 0 && dayUnscheduled.length === 0) return;
      const setCount =
        myDay.sections.reduce((n, sec) => n + sec.items.filter((i) => i.kind === 'set').length, 0) +
        dayUnscheduled.length;
      const groupId = `myday-${day.index}`;
      const collapsed = plan.collapsed.has(groupId);
      out.push({ kind: 'group', key: `g-${groupId}`, groupId, label: day.label || day.date, count: setCount, collapsed });
      if (collapsed) return;
      for (const section of myDay.sections) {
        out.push({
          kind: 'subgroup',
          key: `sg-${day.index}-${section.part}`,
          label: section.title,
          count: section.items.filter((i) => i.kind === 'set').length,
        });
        for (const item of section.items) {
          if (item.kind === 'set') {
            if (item.walkFromPrev) {
              out.push({
                kind: 'walk',
                key: `walk-${item.key}`,
                minutes: item.walkFromPrev.minutes,
                fromStage: getStageName(item.walkFromPrev.fromStageId) || 'Unknown',
              });
            }
            out.push({ kind: 'set', key: item.key, set: item.set, priority: visiblePicks[item.set.id]! });
          } else if (item.kind === 'gap') {
            out.push({ kind: 'gap', key: item.key, minutes: item.minutes });
          } else {
            out.push({
              kind: 'meet',
              key: item.key,
              label: item.label,
              location: item.location,
              timeLabel: fmtZonedClock(item.startMs, festivalTimeZone),
            });
          }
        }
      }
      if (dayUnscheduled.length > 0) {
        out.push({
          kind: 'subgroup',
          key: `sg-${day.index}-unscheduled`,
          label: COPY.myDay.unscheduled,
          count: dayUnscheduled.length,
        });
        dayUnscheduled.forEach((set) =>
          out.push({ kind: 'set', key: `set-${set.id}`, set, priority: visiblePicks[set.id]! }),
        );
      }
    });
    const noDay = sets.filter((s) => visiblePicks[s.id] && !isSetScheduled(s, storeDays));
    if (noDay.length > 0) {
      const collapsed = plan.collapsed.has('myday-tba');
      out.push({ kind: 'group', key: 'g-myday-tba', groupId: 'myday-tba', label: 'Unscheduled', count: noDay.length, collapsed });
      if (!collapsed) {
        noDay.forEach((set) => out.push({ kind: 'set', key: `set-${set.id}`, set, priority: visiblePicks[set.id]! }));
      }
    }
    return out;
  }, [
    activePlanList,
    reminderItems,
    noteItems,
    search,
    separator,
    getStageName,
    days,
    plan.collapsed,
    myDayMode,
    rows,
    effectiveFilter,
    conflictIds,
    myPicks,
    sets,
    storeDays,
    festivalTimeZone,
    stages,
    meetingPoints,
    conflictGroups,
  ]);


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
      setPlanList(null);
      toggleFilter(next);
    },
    [haptics, toggleFilter],
  );

  const setGroupModeHaptic = useCallback(
    (mode: PicksGroupMode | 'myday') => {
      haptics.select();
      setPlanList(null);
      setMyDayMode(mode === 'myday');
      if (mode !== 'myday') setGroupMode(mode);
    },
    [haptics, setGroupMode],
  );

  const togglePlanList = useCallback(
    (kind: PlanListKind) => {
      haptics.select();
      setPlanList((cur) => (cur === kind ? null : kind));
    },
    [haptics],
  );

  const setOrderHaptic = useCallback(
    (next: PicksOrder) => {
      haptics.select();
      setPlanList(null);
      setOrder(next);
    },
    [haptics, setOrder],
  );

  const clearFilters = useCallback(() => {
    haptics.tap();
    clearPlanFilters();
    setPlanList(null);
    setSearchOpen(false);
  }, [haptics, clearPlanFilters]);

  // ── Bulk pick helpers ───────────────────────────────────────────────────
  // Group every cached set (all days) by stage and by artist genre so the user
  // can add a whole group in ONE coalesced write via useBulkAddPicks.
  const bulkGroups = useMemo(() => buildBulkPickGroups(sets, stages, getStageName), [sets, stages, getStageName]);
  const stageGroups = bulkGroups.stages;
  const genreGroups = bulkGroups.genres;
  // The genre groups are named from Spotify genres, so they carry the attribution (Spotify Developer Policy II.4).
  const genreAttribution = useMemo(() => spotifyAttributionFor(sets.flatMap((set) => set.artists ?? [])), [sets]);
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
      if (item.kind === 'walk') return <WalkRow minutes={item.minutes} fromStage={item.fromStage} />;
      if (item.kind === 'gap') return <GapRow minutes={item.minutes} />;
      if (item.kind === 'meet') {
        return <MeetRow label={item.label} location={item.location} timeLabel={item.timeLabel} />;
      }
      if (item.kind === 'planItem') {
        return (
          <PlanListRow
            item={item.item}
            listKind={item.listKind}
            stageName={getStageName(item.item.set.stageId) || 'Unknown'}
            b2bSeparator={separator}
            onPress={() => router.push(`/set/${item.item.set.id}`)}
          />
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
          clashLabel={clashBadges.get(item.set.id)?.label}
          hasNote={!!getMyNote(item.set.id)}
          b2bSeparator={currentFestival?.b2bSeparator}
          onListen={() => router.push(`/set/${item.set.id}?listen=1`)}
          reminderMinutes={getMyReminder(item.set.id)}
        />
      );
    },
    [
      styles,
      separator,
      getStageName,
      getStageColor,
      getMyPick,
      getMyNote,
      getMyReminder,
      handlePickChange,
      conflictIds,
      clashBadges,
      router,
      t,
      toggleCollapse,
      currentFestival?.b2bSeparator,
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


  // Nothing to export / share with zero picks — disable so the action can't
  // produce an empty .ics or share an empty plan.
  const noPicks = stats.total === 0;

  const calendarButton = <PicksCalendarButton
      exportBusy={exportBusy}
      handleAddToCalendar={handleAddToCalendar}
      noPicks={noPicks}
    />;

  // One share hub (link, QR, scan, text). Open even with no picks so Scan QR is reachable.
  // The share link is a server page, so a guest is asked to sign in first.
  const handleSharePicks = useCallback(() => {
    haptics.tap();
    if (!user) {
      useUIStore.getState().showToast('Sign in to share your picks.', { kind: 'info' });
      router.push('/(auth)/login');
      return;
    }
    router.push({ pathname: '/plan-share', params: { tab: 'link' } });
  }, [router, haptics, user]);

  // "Listen before you go": every pick by day with Spotify link-outs. No Spotify sign-in.
  const listenList = useMemo(
    () =>
      buildListenList(
        sets.filter((s) => myPicks?.[s.id]),
        storeDays,
        currentFestival?.b2bSeparator,
      ),
    [sets, myPicks, storeDays, currentFestival?.b2bSeparator],
  );
  // Mobile has no clipboard module; the share sheet offers Copy.
  const handleShareListenList = useCallback(() => {
    if (!currentFestival) return;
    haptics.tap();
    Share.share({ message: listenListText(currentFestival.name, listenList) }).catch(() => {});
  }, [currentFestival, listenList, haptics]);

  const listenSection =
    listenList.length > 0 ? (
      <PicksListenSection
        handleShareListenList={handleShareListenList}
        listenList={listenList}
        listenOpen={listenOpen}
        setListenOpen={setListenOpen}
      />
    ) : null;

  // ── At-a-glance summary + focus filter chips ─────────────────────────────
  const hasPlan = stats.total > 0 || reminderItems.length > 0 || noteItems.length > 0;
  const summaryRow =
    hasPlan ? (
      <PicksSummaryRow
        activePlanList={activePlanList}
        effectiveFilter={effectiveFilter}
        noteItems={noteItems}
        reminderItems={reminderItems}
        setFocusFilter={setFocusFilter}
        stats={stats}
        togglePlanList={togglePlanList}
      />
    ) : null;

  const controlsRow =
    stats.total > 0 ? (
      <PicksControlsRow
        groupMode={groupMode}
        myDayMode={myDayMode}
        search={search}
        searchOpen={searchOpen}
        setGroupModeHaptic={setGroupModeHaptic}
        setSearch={setSearch}
        setSearchOpen={setSearchOpen}
      />
    ) : null;

  const orderRow =
    stats.total > 0 && !myDayMode ? (
      <PicksOrderRow
        order={order}
        setOrderHaptic={setOrderHaptic}
      />
    ) : null;

  const searchField =
    stats.total > 0 && searchOpen ? (
      <PicksSearchField
        search={search}
        setSearch={setSearch}
      />
    ) : null;

  const bulkPanel = hasBulkGroups ? (
    <PicksBulkPanel
      bulkBusyKey={bulkBusyKey}
      bulkOpen={bulkOpen}
      bulkPriority={bulkPriority}
      genreAttribution={genreAttribution}
      genreGroups={genreGroups}
      handleBulkApply={handleBulkApply}
      setBulkOpen={setBulkOpen}
      setBulkPriority={setBulkPriority}
      stageGroups={stageGroups}
    />
  ) : null;

  const picksHeader = <PicksHeader
    bulkPanel={bulkPanel}
    calendarButton={calendarButton}
    conflictGroups={conflictGroups}
    controlsRow={controlsRow}
    currentFestival={currentFestival}
    days={days}
    handleSharePicks={handleSharePicks}
    listenSection={listenSection}
    noPicks={noPicks}
    orderRow={orderRow}
    searchField={searchField}
    setClashY={setClashY}
    summaryRow={summaryRow}
    user={user}
  />;

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
    activePlanList ? (
      <EmptyState
        icon="search-outline"
        title="No matching picks"
        message={`Nothing matches “${search.trim()}”.`}
        action={{ label: 'Clear filters', onPress: clearFilters }}
      />
    ) : stats.total === 0 ? (
      <EmptyState
        illustration="noPicks"
        title="No picks yet"
        message="Browse the lineup and tap the sets you want to see."
        action={{ label: 'Browse the lineup', onPress: () => router.navigate('/(tabs)') }}
      />
    ) : (
      <EmptyState
        icon="search-outline"
        title="No matching picks"
        message={search.trim() ? `Nothing matches “${search.trim()}”.` : 'No picks in this view.'}
        action={filtersActive ? { label: 'Clear filters', onPress: clearFilters } : undefined}
      />
    );

  let body: React.ReactNode;
  if (!currentFestival) {
    body =
      <PicksNoFestivalState
        currentFestival={currentFestival}
        error={error}
        festivals={festivals}
        isLoading={isLoading}
        loadFestivals={loadFestivals}
      />;
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
        data={listRows}
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
        keyboardDismissMode="on-drag"
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
