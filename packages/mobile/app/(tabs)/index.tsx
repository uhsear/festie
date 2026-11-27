import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  BackHandler,
  AppState,
  Platform,
  useWindowDimensions,
  type ListRenderItem,
  type ScrollViewInstance,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useFestivalDataStore,
  useFestivalStore,
  useAuthStore,
  useCrewStore,
  useUIStore,
  selectMyPicks,
  followTodayOnResume,
} from '@festie/shared/stores';
import { useOfflineMapStatus } from '../../hooks/useOfflineDownload';
import { usePicks, useCanPick, useFestival, usePickClear, useFestivalReady, useViewAs } from '@festie/shared/hooks';
import { DISCOVER_COPY } from '@festie/shared/constants';
import {
  artistDisplayName,
  detectConflicts,
  clashBadgeBySetId,
  setMinuteRange,
  festivalPhase,
  splitCardsByNow,
  getHomeActions,
  festivalTimeLabel,
  resolveFestivalTimeZone,
  searchOtherDays,
  searchEmptyCopy,
  searchHiddenByFilters,
  dayTimesNotOut,
  groupScheduleSets,
  defaultScheduleView,
  hasAnyPick,
  isStageFilterActive,
  festivalGenres,
  spotifyAttributionFor,
  scheduleEmptyCopy,
  scheduleEmptyReason,
  visibleDayIndexes,
  lineupReplacesEmptyState,
  lineupFlyerModel,
} from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useListBottomInset } from '../../hooks/useListBottomInset';
import { safeStageColor } from '../../lib/stageColor';
import type { TimeBounds } from '../../hooks/useNowIndicator';
import { useHaptics } from '../../hooks/useHaptics';
import { undoNotifier } from '../../lib/undoNotifier';
import { useNow } from '../../hooks/useNow';
import { useAnnouncedLineup } from '@festie/shared/hooks/useAnnouncedLineup';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import OtherDayMatches from '../../components/OtherDayMatches';
import SetCardMobile from '../../components/SetCardMobile';
import EmptyState from '../../components/EmptyState';
import LoadErrorState from '../../components/LoadErrorState';
import ScreenHeader from '../../components/ScreenHeader';
import TBASection from '../../components/TBASection';
import type { ListRow } from '../../components/schedule/listRow';
import { useStyles } from '../../components/schedule/styles';
import ScheduleSkeleton from '../../components/schedule/ScheduleSkeleton';
import SchedulePickerView from '../../components/schedule/SchedulePickerView';
import ScheduleControls from '../../components/schedule/ScheduleControls';
import ScheduleHeaderActions from '../../components/schedule/ScheduleHeaderActions';
import ScheduleViewSwitcher from '../../components/schedule/ScheduleViewSwitcher';
import ScheduleCardsView from '../../components/schedule/ScheduleCardsView';
import ScheduleTimelineView from '../../components/schedule/ScheduleTimelineView';

const SLOT_MINUTES = 15;
const IOS_NATIVE_TAB_BAR_HEIGHT = 49;

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
  // Timeline view: the page scrolls as one, like Cards. These sizes let the
  // timeline fill the whole viewport once the controls scroll away.
  const [timelineViewportH, setTimelineViewportH] = useState(0);
  const [timelineControlsH, setTimelineControlsH] = useState(0);

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
  const canPick = useCanPick();
  const myPicks = useFestivalDataStore(selectMyPicks);
  const crews = useCrewStore((s) => s.crews);
  const isLoading = useFestivalDataStore((s) => s.isLoading);
  const error = useFestivalDataStore((s) => s.error);
  const stages = useFestivalDataStore((s) => s.stages);
  const allSets = useFestivalDataStore((s) => s.sets);
  const festivalDays = useFestivalDataStore((s) => s.days);

  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const setSearchQuery = useFestivalStore((s) => s.setSearchQuery);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const setActiveStages = useFestivalStore((s) => s.setActiveStages);
  const activeGenres = useFestivalStore((s) => s.activeGenres);
  const setActiveGenres = useFestivalStore((s) => s.setActiveGenres);
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
  const { getMyPick, getOtherPicks, getMyNote, getMyReminder, savePick } = usePicks();
  const clearPick = usePickClear(undoNotifier);
  const lineupNowMs = useNow(60_000);
  const announced = useAnnouncedLineup(lineupNowMs);
  // While no set has a time the lineup shows as a flyer, with no pick controls; the cards return when times publish.
  const flyer = useMemo(
    () => lineupFlyerModel(currentFestival, festivalDays, allSets, lineupNowMs),
    [currentFestival, festivalDays, allSets, lineupNowMs],
  );

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
  const timelineScrollRef = useRef<ScrollViewInstance>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  // Sets that ended earlier today fold into one row; collapsed by default.
  const [earlierOpen, setEarlierOpen] = useState(false);
  // useNow ticks, so the "today" dot follows the festival's own day (06:00
  // cutoff, festival zone) rather than the device calendar.
  const nowMs = useNow();

  // The swap button opens the festival picker over the loaded lineup instead of
  // clearing it, so a failed or cancelled switch (or no signal) loses nothing.
  const [pickingFestival, setPickingFestival] = useState(false);
  const offlineMode = useUIStore((s) => s.offlineMode);

  useEffect(() => {
    if (festivals.length === 0) {
      loadFestivals().catch((err) => Sentry.captureException(err));
    }
  }, [festivals.length, loadFestivals]);

  // The persisted festival data is restored; this reloads it when only the id survived.
  // One automatic try per id: a failed fetch leaves the id with no festival, which
  // would otherwise re-fire this effect forever. The picker retries by hand.
  const reloadTriedRef = useRef<string | null>(null);
  const revalidatedRef = useRef(false);
  useEffect(() => {
    if (!currentFestivalId || currentFestival || isLoading || reloadTriedRef.current === currentFestivalId) return;
    reloadTriedRef.current = currentFestivalId;
    // This load is already fresh, so the cold-start revalidate below must not repeat it.
    revalidatedRef.current = true;
    selectFestival(currentFestivalId).catch((err) => Sentry.captureException(err));
  }, [currentFestivalId, currentFestival, isLoading, selectFestival]);

  // A cached festival shows at once, but a cold start must still revalidate it in
  // the background. Resume moves the day tab to today (no fetch).
  useEffect(() => {
    // A load seen in flight (picker choice) is already fresh; skip the duplicate.
    if (isLoading) revalidatedRef.current = true;
    if (revalidatedRef.current || !currentFestivalId || !currentFestival || isLoading) return;
    revalidatedRef.current = true;
    selectFestival(currentFestivalId).catch((err) => Sentry.captureException(err));
  }, [currentFestivalId, currentFestival, isLoading, selectFestival]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') followTodayOnResume();
    });
    return () => sub.remove();
  }, []);

  // When a guest signs in while a festival is already selected, the profiles
  // weren't fetched (selectFestival skips them for guests). Load them now so
  // picks/notes light up without forcing a manual festival re-select.
  useEffect(() => {
    if (user && currentFestivalId && !currentProfile) {
      loadProfiles(currentFestivalId).catch((err) => Sentry.captureException(err));
    }
  }, [user, currentFestivalId, currentProfile, loadProfiles]);

  // Pull-to-refresh: re-fetch the selected festival's sets/stages/profile, or
  // the festival list when sitting on the picker. Mirrors FestivalList.
  const handleRefresh = useCallback(() => {
    if (currentFestival) {
      selectFestival(currentFestival.id).catch((err) => Sentry.captureException(err));
    } else {
      loadFestivals().catch((err) => Sentry.captureException(err));
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
  // Feeds the next-step band (`getHomeActions`); null when the festival has no
  // usable dates, in which case the band is empty.
  const phase = useMemo(() => festivalPhase(currentFestival, days, new Date(nowMs)), [currentFestival, days, nowMs]);
  const pickCount = Object.keys(myPicks ?? {}).length;
  const hasCrew = crews.some((c) => !c.festivalId || c.festivalId === currentFestival?.id);
  const homeActions = getHomeActions({ phase, signedIn: !!user, pickCount, hasCrew });

  // Device notification permission for the Festival ready checklist. Re-read on
  // focus so it updates after the user comes back from system settings.
  const [notificationsAllowed, setNotificationsAllowed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      Notifications.getPermissionsAsync()
        .then((p) => setNotificationsAllowed(p.status === 'granted'))
        .catch(() => setNotificationsAllowed(false));
    }, []),
  );
  const offlineMapStatus = useOfflineMapStatus(currentFestivalId ?? '');
  const ready = useFestivalReady(notificationsAllowed, undefined, offlineMapStatus);

  // The person's remembered view for this festival wins; otherwise Timeline on a
  // live day with timed sets, Cards. A stored 'grid' never reaches here because
  // Grid is a pushed route that is not remembered. While the lineup flyer shows
  // (no set has a time) only Cards can render it, whatever view was remembered.
  const viewMode: 'cards' | 'timeline' = flyer
    ? 'cards'
    : scheduleView === 'cards' || scheduleView === 'timeline'
      ? scheduleView
      : defaultScheduleView({ hasTimedSets: festivalHasTimedSets, phase });
  const picks = myPicks ?? undefined;
  const canFilterMine = hasAnyPick(picks);
  const mineActive = onlyMine && canFilterMine;
  const stageFilterActive = isStageFilterActive(activeStages, stages.length);
  const genreFilterActive = activeGenres.length > 0;
  const genreChips = useMemo(() => festivalGenres(allSets), [allSets]);
  // The genre chips come from Spotify, so the filter carries the attribution (Spotify Developer Policy II.4).
  const genreAttribution = useMemo(() => spotifyAttributionFor(allSets.flatMap((set) => set.artists ?? [])), [allSets]);
  const visibleDays = visibleDayIndexes(days.length, hiddenDays, selectedDay);

  // Day + stage + My picks + search filtering lives in the shared hook
  // (getFilteredSets). Time order, with sets that ended earlier today split out
  // so Cards can fold them into one row.
  const { earlier: earlierSets, rest: restSets } = useMemo(
    () =>
      splitCardsByNow(getFilteredSets(), {
        days: festivalDays,
        nowMs,
        timeZone: festivalTimeZone,
        separator: currentFestival?.b2bSeparator,
      }),
    // getFilteredSets is recreated when day/stage/My picks/search/sets change.
    [getFilteredSets, currentFestival?.b2bSeparator, festivalDays, nowMs, festivalTimeZone],
  );
  const filteredSets = useMemo(() => [...earlierSets, ...restSets], [earlierSets, restSets]);

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

  // Each clashing set names its worst overlap; the ids feed TimelineView unchanged.
  const conflicts = useMemo(() => detectConflicts(filteredSets, getMyPick), [filteredSets, getMyPick]);
  const clashBadges = useMemo(
    () => clashBadgeBySetId(conflicts, currentFestival?.b2bSeparator),
    [conflicts, currentFestival?.b2bSeparator],
  );
  const conflictIds = useMemo(() => new Set(clashBadges.keys()), [clashBadges]);

  // Cards view: a header row per "Group by" section (Time, Stage or A-Z), then
  // its sets. Ended sets of today sit behind one "Earlier today (n)" row first.
  // Don't fold what the person asked for (a search) or the only thing there is
  // (late night, nothing left to come) behind the collapsed row.
  // The row stays while open so it can fold the sets away again; only the forced cases hide it.
  const earlierForced = restSets.length === 0 || searchQuery.trim() !== '';
  const showEarlier = earlierOpen || earlierForced;
  const rows = useMemo<ListRow[]>(
    () => [
      ...(earlierSets.length > 0 && !earlierForced
        ? [{ kind: 'earlier' as const, key: 'earlier' as const, count: earlierSets.length }]
        : []),
      ...groupScheduleSets(
        showEarlier ? filteredSets : restSets,
        groupBy,
        stages,
        currentFestival?.b2bSeparator,
      ).flatMap((g) => [
        {
          kind: 'groupHeader' as const,
          key: `group-${g.key}`,
          label: g.label,
          stageColor:
            groupBy === 'stage' && g.key ? safeStageColor(getStageColor(g.key), t.colors.text.muted) : undefined,
        },
        ...g.sets.map((set) => ({ kind: 'set' as const, key: set.id, set })),
      ]),
    ],
    [
      earlierSets.length,
      earlierForced,
      showEarlier,
      filteredSets,
      restSets,
      groupBy,
      stages,
      currentFestival?.b2bSeparator,
      getStageColor,
      t.colors.text.muted,
    ],
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
  const hasTimeline = timeBounds !== null && visibleStages.length > 0;

  // Stage chips are tap-to-show-only, the same model as web (shared toggleStageFilter).
  const allStageIds = useMemo(() => stages.map((st) => st.id), [stages]);

  const handlePickChange = useCallback(
    (setId: string, priority: Priority | null) => {
      if (!currentFestival) return;
      if (priority === null) {
        const found = useFestivalStore.getState().sets.find((s) => s.id === setId);
        clearPick(setId, found ? artistDisplayName(found, currentFestival.b2bSeparator) : 'pick');
        return;
      }
      // The card shows the Retry chip on failure.
      savePick(currentFestival.id, setId, priority).catch((err) => {
        Sentry.captureException(err);
        haptics.warning();
      });
    },
    [currentFestival, savePick, clearPick, haptics],
  );

  // One-tap reset for every active schedule filter (search text, my-picks, stage
  // selection) — the recoverability companion to the results summary chip.
  const viewAs = useViewAs();
  const clearAllFilters = useCallback(() => {
    haptics.select();
    setSearchQuery('');
    setOnlyMine(false);
    setActiveStages([]);
    setActiveGenres([]);
    viewAs.clear();
  }, [haptics, setSearchQuery, setOnlyMine, setActiveStages, setActiveGenres, viewAs]);

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

  // The search field and filter rows live in the scrolling controls, so bring
  // them into view when a toggle opens them.
  const revealControls = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotion });
    timelineScrollRef.current?.scrollTo({ y: 0, animated: !reduceMotion });
  };

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
      if (item.kind === 'earlier') {
        const label = `Earlier today (${item.count}), ${earlierOpen ? 'hide' : 'show'} sets that ended earlier`;
        return (
          <TouchableOpacity
            style={styles.earlierRow}
            onPress={() => {
              haptics.select();
              setEarlierOpen((open) => !open);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: earlierOpen }}
            accessibilityLabel={label}
          >
            <Text style={styles.earlierText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Earlier today ({item.count})
            </Text>
            <Ionicons name={earlierOpen ? 'chevron-up' : 'chevron-down'} size={t.iconSize.sm} color={t.colors.text.secondary} />
          </TouchableOpacity>
        );
      }
      const set = item.set;
      return (
        <SetCardMobile
          set={set}
          b2bSeparator={currentFestival?.b2bSeparator}
          onListen={() => router.push(`/set/${set.id}?listen=1`)}
          stageName={getStageName(set.stageId) || 'Unknown'}
          stageColor={safeStageColor(getStageColor(set.stageId), t.colors.text.muted)}
          myPick={getMyPick(set.id)}
          friendProfiles={getOtherPicks(set.id)}
          hasConflict={conflictIds.has(set.id)}
          clashLabel={clashBadges.get(set.id)?.label}
          hasNote={!!getMyNote(set.id)}
          reminderMinutes={getMyReminder(set.id)}
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
      getMyReminder,
      conflictIds,
      clashBadges,
      handlePickChange,
      router,
      haptics,
      earlierOpen,
      currentFestival?.b2bSeparator,
      t.colors.text.secondary,
      t.iconSize.sm,
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
        canPick={canPick}
        currentFestival={currentFestival}
        getMyPick={getMyPick}
        getOtherPicks={getOtherPicks}
        getStageColor={resolveStageColor}
        onSavePick={handlePickChange}
        onOpenDetail={handleSetPress}
        defaultExpanded={timedSets.length === 0}
        allTba={
          timedSets.length === 0 && dayTimesNotOut(currentFestival, festivalDays, allSets.filter((s) => s.dayIndex === selectedDay))
        }
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

  // The announced lineup stands in for "No sets for this day" only when the day has no sets at all.
  // A filter that emptied the day keeps its own empty state, which offers the button that undoes it.
  const lineupStandsIn = lineupReplacesEmptyState(announced, searchQuery);

  const errorScheduleState = (
    <LoadErrorState
      title="Couldn’t load the schedule"
      message={scheduleLoadError ?? ''}
      action={{
        label: 'Try again',
        onPress: () => {
          if (currentFestival) selectFestival(currentFestival.id).catch((err) => Sentry.captureException(err));
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
                  setActiveGenres([]);
                  viewAs.clear();
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
    genreFilterActive,
    viewAsName: viewAs.target?.name,
  });
  const filterEmptyState = (reason: 'viewAs' | 'picks' | 'stages' | 'genres') => {
    const copy = scheduleEmptyCopy(reason, selectedDayLabel ?? 'this day', viewAs.target?.name);
    const undo =
      reason === 'viewAs'
        ? viewAs.clear
        : reason === 'picks'
        ? () => setOnlyMine(false)
        : reason === 'genres'
          ? () => setActiveGenres([])
          : () => setActiveStages([]);
    return (
      <EmptyState
        icon={reason === 'picks' || reason === 'viewAs' ? 'star-outline' : 'filter-outline'}
        title={copy.title}
        message={copy.message}
        action={copy.actionLabel ? { label: copy.actionLabel, onPress: undo } : undefined}
      />
    );
  };

  // A festival with no days at all has no "other day" to pick, so "No sets for this day" would mislead.
  const noDaysState = (
    <EmptyState
      icon="time-outline"
      title={DISCOVER_COPY.banner.title}
      message="The schedule has not been posted yet. Check back soon."
    />
  );

  // A filtered-out day still HAS sets, so the filter is blamed instead of the
  // false "No sets for this day". The timeless-sets hint still wins when the day
  // has TBA sets (timelessSets non-empty).
  const emptyScheduleState =
    emptyReason === 'search' ? (
      searchEmptyState
    ) : (emptyReason === 'viewAs' ||
      emptyReason === 'picks' ||
      emptyReason === 'stages' ||
      emptyReason === 'genres') &&
    timelessSets.length === 0 ? (
      filterEmptyState(emptyReason)
    ) : days.length === 0 ? (
      noDaysState
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
  ) : lineupStandsIn ? undefined : emptyReason === 'search' ? (
    searchEmptyState
  ) : emptyReason === 'viewAs' ||
    emptyReason === 'picks' ||
    emptyReason === 'stages' ||
    emptyReason === 'genres' ? (
    filterEmptyState(emptyReason)
  ) : days.length === 0 ? (
    noDaysState
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
      <SchedulePickerView
        currentFestival={currentFestival}
        offlineMode={offlineMode}
        pickingFestival={pickingFestival}
        setPickingFestival={setPickingFestival}
      />
    );
  }

  // DC1 — a filter is "active" when it's currently hiding/altering rows. The
  // search and filter panels stay forced-open while their state is active so a
  // user can always see (and clear) a filter that's shrinking the schedule,
  // even though both default to collapsed.
  // Hidden days are a preference, not a filter, so they never force the panel open.
  const filtersActive = mineActive || stageFilterActive || genreFilterActive;
  const searchOpen = showSearch || searchQuery.length > 0;
  const filtersOpen = showFilters || filtersActive;
  // Any narrowing in effect (search OR my-picks OR a stage subset) — gates the
  // results-summary + Clear-all chip.
  const anyFilterActive = searchQuery.trim() !== '' || filtersActive || viewAs.target !== null;

  // Schedule controls (Now & Next, phase actions, search, day + stage filters).
  // In Cards view these ride in the FlatList's ListHeaderComponent so the WHOLE
  // page scrolls as one — the cards get full height instead of a small window
  // pinned under a tall fixed chrome stack. In Timeline view they stay fixed
  // above the bounded 2D timeline (which manages its own internal scroll).
  // Passed as an element (not an inline component) so the search TextInput keeps
  // focus across keystroke re-renders.
  const controls = (
    <ScheduleControls
      activeGenres={activeGenres}
      activeStages={activeStages}
      allStageIds={allStageIds}
      anyFilterActive={anyFilterActive}
      canFilterMine={canFilterMine}
      clearAllFilters={clearAllFilters}
      currentProfile={currentProfile}
      days={days}
      dismissPhaseBand={dismissPhaseBand}
      dismissedPhase={dismissedPhase}
      filteredSets={filteredSets}
      filtersOpen={filtersOpen}
      genreAttribution={genreAttribution}
      genreChips={genreChips}
      genreFilterActive={genreFilterActive}
      groupBy={groupBy}
      hPad={hPad}
      handleRefresh={handleRefresh}
      hiddenDays={hiddenDays}
      homeActions={homeActions}
      isLoading={isLoading}
      mineActive={mineActive}
      onlyMine={onlyMine}
      phase={phase}
      ready={ready}
      resolveStageColor={resolveStageColor}
      searchOpen={searchOpen}
      searchQuery={searchQuery}
      setActiveGenres={setActiveGenres}
      setActiveStages={setActiveStages}
      setHiddenDays={setHiddenDays}
      setOnlyMine={setOnlyMine}
      setScheduleGroupBy={setScheduleGroupBy}
      setSearchQuery={setSearchQuery}
      showSearch={showSearch}
      stageFilterActive={stageFilterActive}
      stages={stages}
      timelessSets={timelessSets}
      user={user}
      viewAs={viewAs}
      viewMode={viewMode}
      visibleDays={visibleDays}
      width={width}
      zoneLabel={zoneLabel}
    />
  );

  // The Switch + Now & Next actions live in the header's trailing slot.
  const headerActions = (
    <ScheduleHeaderActions
      handleRefresh={handleRefresh}
      isLoading={isLoading}
      viewMode={viewMode}
      width={width}
    />
  );

  return (
    // ScreenHeader owns the top safe-area inset (insets.top + spacing[4]) — the
    // native Tabs nav header is hidden (see (tabs)/_layout.tsx), so this is the
    // single top of the screen, sitting above the consolidated control row.
    <View style={styles.container} testID="schedule-screen">
      <ScreenHeader
        title={currentFestival.name}
        icon="calendar-outline"
        right={headerActions}
        onTitlePress={() => setPickingFestival(true)}
        titleAccessibilityLabel={`${currentFestival.name}. Switch festival`}
      />
      {/* DC1 — one consolidated control row: LiveDot now-indicator, the
          view switcher, and the search/filter toggles. The search bar and the
          stage/phase filters fold inline below (in `controls`) only when their
          toggle is on or they carry active state, reclaiming vertical space. */}
      <ScheduleViewSwitcher
        flyerShowing={!!flyer}
        festivalHasTimedSets={festivalHasTimedSets}
        filtersActive={filtersActive}
        filtersOpen={filtersOpen}
        hPad={hPad}
        revealControls={revealControls}
        searchOpen={searchOpen}
        setScheduleView={setScheduleView}
        setSearchQuery={setSearchQuery}
        setShowFilters={setShowFilters}
        setShowSearch={setShowSearch}
        viewMode={viewMode}
      />

      {/* Schedule body — view-mode specific. In both views the WHOLE page
          scrolls as one: Cards carries the `controls` in the FlatList's
          ListHeaderComponent, and Timeline puts them above a timeline sized to
          the full viewport, so scrolling past them shows the timeline full size. */}
      {viewMode === 'cards' ? (
        <ScheduleCardsView
          announced={announced}
          cardsEmpty={cardsEmpty}
          cardsSeparator={cardsSeparator}
          controls={controls}
          flyer={flyer}
          genreFilterActive={genreFilterActive}
          hPad={hPad}
          handleCardsScroll={handleCardsScroll}
          keyExtractor={keyExtractor}
          listBottomPad={listBottomPad}
          listRef={listRef}
          otherDayMatches={otherDayMatches}
          phase={phase}
          refreshControl={refreshControl}
          renderRow={renderRow}
          rows={rows}
          scheduleViewportBottomInset={scheduleViewportBottomInset}
          scrollCardsToTop={scrollCardsToTop}
          searchQuery={searchQuery}
          showScrollTop={showScrollTop}
          stageFilterActive={stageFilterActive}
        />
      ) : (
        <ScheduleTimelineView
          allSets={allSets}
          announced={announced}
          controls={controls}
          currentFestival={currentFestival}
          days={days}
          emptyScheduleState={emptyScheduleState}
          errorScheduleState={errorScheduleState}
          getMyPick={getMyPick}
          hPad={hPad}
          handleSetPress={handleSetPress}
          hasTimeline={hasTimeline}
          height={height}
          lineupStandsIn={lineupStandsIn}
          listBottomPad={listBottomPad}
          myPicks={myPicks}
          refreshControl={refreshControl}
          resolveStageColor={resolveStageColor}
          scheduleColdLoading={scheduleColdLoading}
          scheduleLoadError={scheduleLoadError}
          scheduleViewportBottomInset={scheduleViewportBottomInset}
          selectedDay={selectedDay}
          setTimelineControlsH={setTimelineControlsH}
          setTimelineViewportH={setTimelineViewportH}
          tbaSection={tbaSection}
          timeBounds={timeBounds}
          timedSets={timedSets}
          timelineControlsH={timelineControlsH}
          timelineScrollRef={timelineScrollRef}
          timelineViewportH={timelineViewportH}
          visibleStages={visibleStages}
        />
      )}
    </View>
  );
}
