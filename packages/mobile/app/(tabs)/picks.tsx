import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
  Linking,
  TextInput,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore, useCrewStore, useFestivalDataStore, useUIStore, selectMyPicks } from '@festie/shared/stores';
import { usePicks, useFestival, usePicksPlan, usePickClear, useBulkAddPicks } from '@festie/shared/hooks';
import type { FestivalSet, Priority } from '@festie/shared/types';
import {
  artistDisplayName,
  buildBulkPickGroups,
  BULK_SCOPE_LABEL,
  type PicksRow,
  type PicksFilter,
  type PicksGroupMode,
  type PicksOrder,
  type PlanListItem,
  type PlanListKind,
  buildPicksIcsExport,
  describeIcsExport,
  buildListenList,
  listenListText,
  buildMyDay,
  buildPlanList,
  clashBadgeBySetId,
  fmtZonedClock,
  foldSearch,
} from '@festie/shared/utils';
import { mapErrorToUserMessage, fetchCalendarLinks } from '@festie/shared/services';
import { COPY, PRIORITY_SYMBOLS, clashCount } from '@festie/shared/constants';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useHaptics } from '../../hooks/useHaptics';
import { duration as motionDuration } from '@festie/shared/tokens';
import { safeStageColor } from '../../lib/stageColor';
import { priorityColor } from '../../lib/priorityColor';
import { undoNotifier } from '../../lib/undoNotifier';
import { priorityIconName } from '../../lib/prioritySymbol';
import { CONCEPT_IONICON } from '../../lib/conceptIcons';
import ScreenHeader from '../../components/ScreenHeader';
import EmptyState from '../../components/EmptyState';
import GuestPicksBanner from '../../components/GuestPicksBanner';
import { Skeleton } from '../../components/Skeleton';
import SetCardMobile from '../../components/SetCardMobile';
import CrewSuggestionStrip from '../../components/CrewSuggestionStrip';
import RateNightBanner from '../../components/RateNightBanner';
import LockscreenStaleBanner from '../../components/LockscreenStaleBanner';
import OfflineReadinessCard from '../../components/OfflineReadinessCard';
import ClashCards from '../../components/ClashCards';
import { WalkRow, GapRow, MeetRow, PlanListRow } from '../../components/PlanRows';

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
      const q = foldSearch(search.trim());
      const items = (activePlanList === 'reminders' ? reminderItems : noteItems).filter(
        (item) =>
          !q ||
          foldSearch(artistDisplayName(item.set, separator)).includes(q) ||
          foldSearch(getStageName(item.set.stageId) || '').includes(q),
      );
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
    const visiblePicks: Record<string, Priority> = {};
    for (const row of rows) if (row.kind === 'set' && myPicks?.[row.set.id]) visiblePicks[row.set.id] = myPicks[row.set.id]!;
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

  // Export the user's picks to a .ics the OS can import into any calendar app.
  // Built fully client-side from the already-loaded store data (no server call,
  // works offline) and shared via the OS sheet — same write/share flow as the
  // account data export.
  const handleDownloadCalendar = useCallback(async () => {
    if (!currentFestival || !currentProfile || exportBusy) return;
    setExportBusy(true);
    try {
      const result = buildPicksIcsExport({
        festival: {
          id: currentFestival.id,
          name: currentFestival.name,
          location: currentFestival.location,
        },
        sets,
        stages,
        picks: currentProfile.picks,
        notes: currentProfile.notes,
        reminders: currentProfile.reminders,
      });
      const ics = result.ics;
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
        useUIStore.getState().showToast(describeIcsExport(result), { kind: 'success' });
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

  // Subscribe to the live feed: webcal:// opens the iOS Calendar subscribe prompt.
  // Android has no webcal handler, so the open rejects and Google Calendar's
  // add-by-URL page takes over. No scheme probe: on iOS that needs a native plist entry.
  const handleSubscribeCalendar = useCallback(async () => {
    if (!currentFestival) return;
    let links: Awaited<ReturnType<typeof fetchCalendarLinks>>;
    try {
      links = await fetchCalendarLinks(currentFestival.id);
    } catch {
      haptics.warning();
      useUIStore
        .getState()
        .showToast("Couldn't get your calendar link. Check your connection and try again.", { kind: 'error' });
      return;
    }
    try {
      await Linking.openURL(links.webcalUrl);
    } catch {
      Linking.openURL(links.googleUrl).catch(() => haptics.warning());
    }
  }, [currentFestival, haptics]);

  const handleAddToCalendar = useCallback(() => {
    haptics.tap();
    Alert.alert(
      'Add to calendar',
      'Subscribe keeps your calendar up to date when set times change. Download once saves a file that does not update.',
      [
        { text: 'Subscribe (stays up to date)', onPress: () => void handleSubscribeCalendar() },
        { text: 'Download once', onPress: () => void handleDownloadCalendar() },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [haptics, handleSubscribeCalendar, handleDownloadCalendar]);

  // Nothing to export / share with zero picks — disable so the action can't
  // produce an empty .ics or share an empty plan.
  const noPicks = stats.total === 0;

  const calendarButton = (
    <TouchableOpacity
      style={[styles.calendarButton, (exportBusy || noPicks) && styles.calendarButtonDisabled]}
      onPress={handleAddToCalendar}
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
        {exportBusy ? 'Exporting…' : 'Calendar'}
      </Text>
    </TouchableOpacity>
  );

  // One share hub (link, QR, scan, text). Open even with no picks so Scan QR is reachable.
  const handleSharePicks = useCallback(() => {
    haptics.tap();
    router.push({ pathname: '/plan-share', params: { tab: 'link' } });
  }, [router, haptics]);

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
      <View style={styles.listenCard}>
        <TouchableOpacity
          style={styles.listenToggle}
          onPress={() => setListenOpen((o) => !o)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ expanded: listenOpen }}
        >
          <Ionicons name="musical-notes-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.listenTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Listen before you go
          </Text>
          <Ionicons name={listenOpen ? 'chevron-up' : 'chevron-down'} size={16} color={t.colors.text.secondary} />
        </TouchableOpacity>
        {listenOpen && (
          <View>
            {listenList.map((day) => (
              <View key={day.label} style={styles.listenDay}>
                <Text style={styles.listenDayLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {day.label}
                </Text>
                {day.rows.map((row) => (
                  <View key={row.setId} style={styles.listenRow}>
                    <Text style={styles.listenName} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {row.name}
                    </Text>
                    {row.spotifyUrl ? (
                      <TouchableOpacity
                        style={styles.listenLinkHit}
                        onPress={() => Linking.openURL(row.spotifyUrl as string).catch(() => {})}
                        accessibilityRole="link"
                        accessibilityLabel={`Open ${row.name} in Spotify`}
                      >
                        <Text style={styles.listenLink} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                          Spotify ↗
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))}
              </View>
            ))}
            <TouchableOpacity
              style={styles.calendarButton}
              onPress={handleShareListenList}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Ionicons name="share-outline" size={16} color={t.colors.accent.aqua} />
              <Text style={styles.calendarButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
                Share as text
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    ) : null;

  // ── At-a-glance summary + focus filter chips ─────────────────────────────
  const hasPlan = stats.total > 0 || reminderItems.length > 0 || noteItems.length > 0;
  const summaryRow =
    hasPlan ? (
      <View style={styles.summaryRow}>
        {stats.total > 0 ? (
          <StatChip
            label="All"
            count={stats.total}
            active={effectiveFilter === 'all' && !activePlanList}
            onPress={() => setFocusFilter('all')}
          />
        ) : null}
        {stats.must > 0 ? (
          <StatChip
            label="Must"
            count={stats.must}
            color={t.colors.priority.must}
            icon={priorityIconName('must')}
            active={effectiveFilter === 'must' && !activePlanList}
            onPress={() => setFocusFilter('must')}
          />
        ) : null}
        {stats.want > 0 ? (
          <StatChip
            label="Want"
            count={stats.want}
            color={t.colors.priority.want}
            icon={priorityIconName('want-to-see')}
            active={effectiveFilter === 'want-to-see' && !activePlanList}
            onPress={() => setFocusFilter('want-to-see')}
          />
        ) : null}
        {stats.maybe > 0 ? (
          <StatChip
            label="Maybe"
            count={stats.maybe}
            color={t.colors.priority.maybe}
            icon={priorityIconName('maybe')}
            active={effectiveFilter === 'maybe' && !activePlanList}
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
            active={effectiveFilter === 'clashes' && !activePlanList}
            onPress={() => setFocusFilter('clashes')}
          />
        ) : null}
        {reminderItems.length > 0 ? (
          <StatChip
            label={COPY.planLists.reminders}
            count={reminderItems.length}
            icon="notifications-outline"
            active={activePlanList === 'reminders'}
            onPress={() => togglePlanList('reminders')}
          />
        ) : null}
        {noteItems.length > 0 ? (
          <StatChip
            label={COPY.planLists.notes}
            count={noteItems.length}
            icon="document-text-outline"
            active={activePlanList === 'notes'}
            onPress={() => togglePlanList('notes')}
          />
        ) : null}
      </View>
    ) : null;

  const controlsRow =
    stats.total > 0 ? (
      <View style={styles.controlsRow}>
        <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Group picks by">
          {(['day', 'priority', 'myday'] as const).map((mode) => {
            const activeMode = mode === 'myday' ? myDayMode : !myDayMode && groupMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.segmentBtn, activeMode && styles.segmentBtnActive]}
                onPress={() => setGroupModeHaptic(mode)}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityState={{ selected: activeMode }}
                accessibilityLabel={
                  mode === 'day' ? 'Group by day' : mode === 'priority' ? 'Group by priority' : 'Show my day'
                }
              >
                <Ionicons
                  name={mode === 'day' ? 'calendar-clear-outline' : mode === 'priority' ? 'flag-outline' : 'time-outline'}
                  size={t.iconSize.xs}
                  color={activeMode ? t.colors.accent.aqua : t.colors.text.muted}
                />
                <Text
                  style={[styles.segmentText, activeMode && styles.segmentTextActive]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  {mode === 'day' ? 'By day' : mode === 'priority' ? 'By priority' : COPY.myDay.name}
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
                <Text
                  style={[styles.segmentText, active && styles.segmentTextActive]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
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
      {!user ? <GuestPicksBanner /> : null}
      {user ? (
        <View style={styles.headerActions}>
          {calendarButton}
          <TouchableOpacity
            style={[styles.calendarButton, noPicks && styles.calendarButtonDisabled]}
            onPress={() => router.push('/picks-image')}
            disabled={noPicks}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ disabled: noPicks }}
            accessibilityLabel="Save my picks as an image"
          >
            <Ionicons name="image-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.calendarButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
              {COPY.picks.saveImage}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.calendarButton, !currentFestival && styles.calendarButtonDisabled]}
            onPress={handleSharePicks}
            disabled={!currentFestival}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ disabled: !currentFestival }}
            accessibilityLabel="Share my picks"
          >
            <Ionicons name="share-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.calendarButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
              {COPY.picks.share}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
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
      <View onLayout={(e) => setClashY(e.nativeEvent.layout.y)}>
        <ClashCards groups={conflictGroups} days={days} />
      </View>
      {bulkPanel}
      {listenSection}
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
    body = (
      <EmptyState
        icon="calendar-outline"
        title="No festival selected"
        message="Choose a festival from the Schedule tab to start saving picks."
      />
    );
  } else if (user && !currentProfile) {
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
  listenCard: {
    marginBottom: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingBottom: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  listenToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 44,
  },
  listenTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  listenDay: {
    marginBottom: t.spacing[2],
  },
  listenDayLabel: {
    ...typeStyle('caption', 700),
    color: t.colors.text.secondary,
  },
  listenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 44,
  },
  listenName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  listenLinkHit: {
    minHeight: 44,
    justifyContent: 'center',
  },
  listenLink: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
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
