import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  useWindowDimensions,
  type HostInstance,
  type ScrollViewInstance,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalDataStore, useFestivalStore } from '@festie/shared/stores';
import { usePicks, useFestival } from '@festie/shared/hooks';
import {
  nowPositionPercent,
  setMinuteRange,
  fmtHour,
  fmtShort,
  artistDisplayName,
  resolveFestivalTimeZone,
  hasAnyPick,
  isStageFilterActive,
  scheduleEmptyCopy,
  scheduleEmptyReason,
  scheduleResultsSummary,
  searchEmptyCopy,
  searchHiddenByFilters,
  type GridBounds,
  type HourMark,
} from '@festie/shared/utils';
import type { FestivalSet, Stage } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE, type Tokens } from '../hooks/useTokens';
import { safeStageColor } from '../lib/stageColor';
import { priorityIconName } from '../lib/prioritySymbol';
import { useNow } from '../hooks/useNow';
import EmptyState from '../components/EmptyState';
import ScheduleDayChips from '../components/ScheduleDayChips';
import ScheduleResultsRow from '../components/ScheduleResultsRow';

// Per-minute vertical scale. The web grid adapts this to viewport width
// (getPxPerMin), but on a phone the grid is the dense 2D surface — fix it at the
// shared narrow-phone density (1.6 px/min) so a full day stays scrollable and
// the column math is stable regardless of rotation.
const PX_PER_MIN = 1.6;
// Sticky left time gutter. Matches the timeline gutter width (useNowIndicator /
// TimelineView use 44) so the two schedule surfaces line up visually.
const GUTTER_W = 44;
// Fixed stage-column width. The web grid flexes columns to fill desktop width;
// a phone never has that room, so each stage is a fixed-width column the user
// scrolls between horizontally.
const COL_W = 132;
// Header row height (stage name labels) above the scrollable body.
const HEADER_H = 40;
// WCAG 2.5.5 — a 15-min set at 1.6 px/min is only 24px; bump cells to a 44px
// minimum tap target (mirrors the web grid's Math.max(..., 44)).
const MIN_CELL_H = 44;

/**
 * Grid — the dense 2D stage×time schedule, a mobile port of the web `/grid`
 * route. Reachable at `/grid` (deep link + the web export's `/grid`). The phone
 * tab schedule defaults to the single-axis Timeline (see `(tabs)/index.tsx`);
 * this screen is the same data laid out as stages-as-columns / time-as-rows,
 * for users who want the at-a-glance overlap view.
 *
 * Data comes entirely from the shared stores/hooks (zero new business logic):
 * festival data store for sets/stages/festival, festivalStore for the selected
 * day + active-stage filter, usePicks for the user's pick + crew overlap, and
 * useFestival for stage color/name resolution. The pure grid math (toMin,
 * fmtHour, fmtShort, bounds) is imported from @festie/shared/utils.
 *
 * Pick colors are resolved from the design tokens (t.colors.priority) rather
 * than the web grid's CSS `var(--color-accent-*)` strings, which RN can't parse.
 */
export default function GridScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const { width: windowW } = useWindowDimensions(); // re-render on rotation so the body re-measures.

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const stages = useFestivalDataStore((s) => s.stages);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const onlyMine = useFestivalStore((s) => s.onlyMine);
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const setActiveStages = useFestivalStore((s) => s.setActiveStages);
  const setOnlyMine = useFestivalStore((s) => s.setOnlyMine);
  const setSearchQuery = useFestivalStore((s) => s.setSearchQuery);
  const picks = useFestivalDataStore((s) => s.currentProfile)?.picks;
  const { getMyPick, getOtherPicks } = usePicks();
  const { getStageColor, getStageName, getDays, getFilteredSets, getCurrentDaySets } = useFestival();
  const dayLabel = getDays()[selectedDay]?.label ?? 'Grid';
  const screenTitle = `${dayLabel} · Grid`;

  // Compact crew-overlap count for a cell — how many OTHER crew members picked
  // a set. Same shared accessor the web grid uses (getOtherPicks reads the
  // persisted profiles, so the count renders offline).
  const getOverlapCount = useCallback((setId: string) => getOtherPicks(setId).length, [getOtherPicks]);

  // Stage color resolver that substitutes a real token for web's `var(...)`
  // fallback so cells never receive an unparseable color (matches index.tsx's
  // resolveStageColor).
  const resolveStageColor = useCallback(
    (stageId: string) => safeStageColor(getStageColor(stageId), t.colors.text.muted),
    [getStageColor, t.colors.text.muted],
  );

  // Active stages (all when none/empty), preserving the festival's stage order —
  // mirrors the web grid's visibleStages + index.tsx's filter.
  const visibleStages = useMemo<Stage[]>(() => {
    if (activeStages.length > 0 && activeStages.length < stages.length)
      return stages.filter((st) => activeStages.includes(st.id));
    return stages;
  }, [stages, activeStages]);

  // Timed sets for the selected day, through the same shared filter (stages,
  // My picks, search) as the Schedule tab.
  const timedSets = useMemo(
    () => getFilteredSets().filter((s) => s.startTime && s.endTime),
    [getFilteredSets],
  );

  // Pre-compute stageId -> sets once per render instead of filtering inside each
  // column (web grid's setsByStage).
  const setsByStage = useMemo(() => {
    const m = new Map<string, FestivalSet[]>();
    for (const s of timedSets) {
      const arr = m.get(s.stageId) || [];
      arr.push(s);
      m.set(s.stageId, arr);
    }
    return m;
  }, [timedSets]);

  const bounds = useMemo<GridBounds | null>(() => {
    if (!timedSets.length) return null;
    let lo = Infinity;
    let hi = 0;
    for (const s of timedSets) {
      const { start, end } = setMinuteRange(s)!;
      lo = Math.min(lo, start);
      hi = Math.max(hi, end);
    }
    lo = Math.floor(lo / 60) * 60;
    hi = Math.ceil(hi / 60) * 60;
    return { lo, hi, span: hi - lo };
  }, [timedSets]);

  const hours = useMemo<HourMark[]>(() => {
    if (!bounds) return [];
    const out: HourMark[] = [];
    for (let m = bounds.lo; m <= bounds.hi; m += 60) out.push({ m, px: (m - bounds.lo) * PX_PER_MIN });
    return out;
  }, [bounds]);

  // Live "now" minute (rolls past midnight to match the bounds). useNow ticks on
  // an interval + on foreground, so the indicator creeps forward without an
  // impure Date.now() in render.
  const nowMs = useNow(60_000);
  const dayDate = getDays()[selectedDay]?.date;
  const festivalTimeZone = resolveFestivalTimeZone(currentFestival);
  const nowPx = useMemo(() => {
    if (!bounds) return null;
    const pct = nowPositionPercent(nowMs, dayDate, { minMin: bounds.lo, maxMin: bounds.hi }, festivalTimeZone);
    return pct === null ? null : (pct / 100) * bounds.span * PX_PER_MIN;
  }, [bounds, nowMs, dayDate, festivalTimeZone]);

  const totalH = bounds ? bounds.span * PX_PER_MIN : 0;

  // Auto-scroll the vertical body to NOW on mount (only when NOW is in bounds).
  const bodyScrollRef = useRef<ScrollViewInstance>(null);
  const headerScrollRef = useRef<ScrollViewInstance>(null);
  const gutterScrollRef = useRef<ScrollViewInstance>(null);
  const didAutoScroll = useRef(false);
  const [bodyH, setBodyH] = useState(0);
  // Horizontal windowing: only stage columns within one column of the viewport
  // mount their gridlines and set cells; the rest are empty same-width spacers.
  const [firstCol, setFirstCol] = useState(0);
  const lastCol = firstCol + Math.ceil(windowW / COL_W);
  useEffect(() => {
    if (didAutoScroll.current || nowPx == null || bodyH === 0) return;
    didAutoScroll.current = true;
    const target = Math.max(0, nowPx - bodyH / 2);
    bodyScrollRef.current?.scrollTo({ y: target, animated: false });
  }, [nowPx, bodyH]);

  // ── PNG export (replicates wrap.tsx's off-screen captureRef pipeline) ──
  const [sharing, setSharing] = useState(false);
  const posterRef = useRef<HostInstance>(null);
  const posterW = GUTTER_W + COL_W * Math.max(visibleStages.length, 1);
  const posterH = HEADER_H + totalH;

  const shareGridText = useCallback(async () => {
    if (!currentFestival) return;
    try {
      await Share.share({
        message: `My ${currentFestival.name} schedule 🎪\n${timedSets.length} sets · ${visibleStages.length} stages\nfestie.us`,
      });
    } catch {
      // User dismissed the share sheet.
    }
  }, [currentFestival, timedSets.length, visibleStages.length]);

  const handleExport = useCallback(async () => {
    if (!currentFestival || sharing || !bounds) return;
    setSharing(true);
    // The poster only mounts while `sharing` is true (it's otherwise ~950
    // phantom off-screen Views). Wait two frames so React commits the poster and
    // lays it out before captureRef looks up its native node.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    try {
      const uri = await captureRef(posterRef, {
        format: 'png',
        quality: 1,
        width: posterW,
        height: posterH,
        result: 'tmpfile',
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: 'Share your Festie grid',
        });
      } else {
        // Sharing unavailable (e.g. simulator) — degrade to a text share rather
        // than silently no-op.
        await shareGridText();
      }
    } catch {
      // Capture failed or sheet dismissed — degrade to a text share.
      await shareGridText();
    } finally {
      setSharing(false);
    }
  }, [currentFestival, sharing, bounds, posterW, posterH, shareGridText]);

  // ── Empty states (mirror the web grid) ──
  if (!currentFestival) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: screenTitle, headerShown: true }} />
        <EmptyState
          icon="calendar-outline"
          title="No festival selected"
          message="Choose a festival from the schedule tab to view the grid."
        />
      </View>
    );
  }
  const stageFilterActive = isStageFilterActive(activeStages, stages.length);
  const filterNarrows = searchQuery.trim() !== '' || (onlyMine && hasAnyPick(picks)) || stageFilterActive;
  const clearAllFilters = () => {
    setSearchQuery('');
    setOnlyMine(false);
    setActiveStages([]);
  };
  const resultsRow = filterNarrows ? (
    <ScheduleResultsRow
      summary={scheduleResultsSummary({
        count: timedSets.length,
        onlyMine: onlyMine && hasAnyPick(picks),
        activeStageCount: stageFilterActive ? activeStages.length : 0,
      })}
      onClearAll={clearAllFilters}
      hPad={t.spacing[4]}
    />
  ) : null;
  if (!timedSets.length || !bounds) {
    const reason = scheduleEmptyReason({
      query: searchQuery,
      onlyMine,
      hasAnyPick: hasAnyPick(picks),
      stageFilterActive,
    });
    let empty: { title: string; message: string; actionLabel?: string; onAction?: () => void };
    if (reason === 'search') {
      const daySets = getCurrentDaySets().filter((s) => s.startTime && s.endTime);
      const hidden = searchHiddenByFilters(daySets, searchQuery, stages);
      const clearFilters = () => {
        setOnlyMine(false);
        setActiveStages([]);
      };
      empty = {
        ...searchEmptyCopy(searchQuery, dayLabel, false, hidden),
        onAction: hidden ? clearFilters : () => setSearchQuery(''),
      };
    } else if (reason === 'picks') {
      empty = { ...scheduleEmptyCopy('picks', dayLabel), onAction: () => setOnlyMine(false) };
    } else if (reason === 'stages') {
      empty = { ...scheduleEmptyCopy('stages', dayLabel), onAction: () => setActiveStages([]) };
    } else {
      empty = {
        title: 'No timed sets to display',
        message: 'There are no sets with scheduled times for this day. Try another day above.',
      };
    }
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: screenTitle, headerShown: true }} />
        <ScheduleDayChips hPad={t.spacing[4]} />
        {resultsRow}
        <EmptyState
          icon="time-outline"
          title={empty.title}
          message={empty.message}
          action={empty.actionLabel && empty.onAction ? { label: empty.actionLabel, onPress: empty.onAction } : undefined}
        />
      </View>
    );
  }

  // One stage column body: hour gridlines + absolutely-positioned set cells.
  const renderColumn = (st: Stage, forExport: boolean) => {
    const stageColor = resolveStageColor(st.id);
    const stageSets = setsByStage.get(st.id) || [];
    return (
      <View key={st.id} style={[styles.col, { height: totalH }]}>
        {/* Hour gridlines (and a fainter half-hour line) */}
        {hours.map(({ m, px }) => (
          <View key={m} style={[styles.hourLine, { top: px }]} />
        ))}
        {hours.slice(0, -1).map(({ m, px }) => (
          <View key={`half-${m}`} style={[styles.halfHourLine, { top: px + 30 * PX_PER_MIN }]} />
        ))}

        {stageSets.map((set) => {
          const { start: a, end: b } = setMinuteRange(set)!;
          const top = (a - bounds.lo) * PX_PER_MIN;
          const height = Math.max((b - a) * PX_PER_MIN, MIN_CELL_H);
          const pick = getMyPick(set.id);
          const pickColor = pick ? t.colors.priority[pick === 'want-to-see' ? 'want' : pick] : null;
          const cellColor = pickColor ?? stageColor;
          const dn = artistDisplayName(set, currentFestival.b2bSeparator);
          const overlap = getOverlapCount(set.id);

          const cellStyle = {
            top,
            height,
            backgroundColor: pickColor ? withAlpha(t, pickColor, 0.28) : withAlpha(t, stageColor, 0.14),
            borderColor: cellColor,
          };

          // The off-screen export poster is captured by react-native-view-shot;
          // it must be a flat View (a Pressable inside a captured tree is fine,
          // but we avoid the press handler / accessibility on the clone).
          const inner = (
            <>
              {pick ? (
                <Ionicons name={priorityIconName(pick)} size={11} color={cellColor} style={styles.pickHeart} aria-hidden />
              ) : null}
              <Text style={styles.cellArtist} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {dn}
              </Text>
              {height >= 48 ? (
                <Text style={styles.cellTime} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {fmtShort(set.startTime!)}–{fmtShort(set.endTime!)}
                </Text>
              ) : null}
              {overlap > 0 ? (
                <View style={styles.overlapBadge}>
                  {/* Sub-scale badge exception: iconSize.xs (12) overwhelms this
                      tiny in-cell overlap pill (micro text, 1px vertical pad). */}
                  <Ionicons name="people" size={9} color={t.colors.accent.aqua} />
                  <Text style={styles.overlapCount}>{overlap}</Text>
                </View>
              ) : null}
            </>
          );

          if (forExport) {
            return (
              <View key={set.id} style={[styles.cell, cellStyle]}>
                {inner}
              </View>
            );
          }

          const overlapLabel =
            overlap > 0 ? `, ${overlap} crew ${overlap === 1 ? 'member' : 'members'} going` : '';
          return (
            <Pressable
              key={set.id}
              style={[styles.cell, cellStyle]}
              onPress={() => router.push(`/set/${set.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${dn} at ${getStageName(st.id) || st.id}, ${fmtShort(set.startTime!)} to ${fmtShort(set.endTime!)}${pick ? ', ' + pick : ''}${overlapLabel}`}
            >
              {inner}
            </Pressable>
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: screenTitle,
          headerShown: true,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => void handleExport()}
              disabled={sharing}
              accessibilityRole="button"
              accessibilityLabel="Export grid as image"
              hitSlop={8}
              style={styles.headerButton}
            >
              {sharing ? (
                <ActivityIndicator size="small" color={t.colors.accent.aqua} />
              ) : (
                <Ionicons name="share-outline" size={20} color={t.colors.accent.aqua} />
              )}
            </TouchableOpacity>
          ),
        }}
      />

      {/* Sticky chrome: the stage header row and the time gutter are separate,
          non-interactive ScrollViews whose offsets follow the body below, so
          stage names and hour labels stay on screen on both axes. */}
      <ScheduleDayChips hPad={t.spacing[4]} />
      {resultsRow}
      <View style={styles.headerBar}>
        <View style={styles.corner} />
        <ScrollView
          ref={headerScrollRef}
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          style={styles.headerStrip}
        >
          <View style={styles.headerRow}>
            {visibleStages.map((st) => (
              <View key={st.id} style={styles.headerCell}>
                <View style={[styles.stageDot, { backgroundColor: resolveStageColor(st.id) }]} />
                <Text style={styles.headerCellText} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {getStageName(st.id) || st.id}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
      <View style={styles.bodyRow}>
        <ScrollView
          ref={gutterScrollRef}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          style={styles.gutterStrip}
          contentContainerStyle={[styles.gutter, { height: totalH }]}
        >
          {hours.map(({ m, px }) => (
            <Text key={m} style={[styles.hourLabel, { top: px }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {fmtHour(m)}
            </Text>
          ))}
        </ScrollView>
        <ScrollView
          ref={bodyScrollRef}
          style={styles.body}
          showsVerticalScrollIndicator
          scrollEventThrottle={16}
          onScroll={(e) => gutterScrollRef.current?.scrollTo({ y: e.nativeEvent.contentOffset.y, animated: false })}
          onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            scrollEventThrottle={16}
            onScroll={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              headerScrollRef.current?.scrollTo({ x, animated: false });
              const col = Math.max(0, Math.floor(x / COL_W));
              setFirstCol((prev) => (prev === col ? prev : col));
            }}
            // The horizontal scroll lives inside the vertical one so both axes
            // scroll: outer = time, inner = stages (web's outer/inner ScrollView
            // model).
            contentContainerStyle={{ height: totalH }}
          >
            <View style={styles.colsRow}>
              {/* Absolute NOW line spanning all columns. */}
              {nowPx != null ? (
                <View style={[styles.nowLine, { top: nowPx, width: COL_W * visibleStages.length }]} pointerEvents="none">
                  <Text style={styles.nowLabel} aria-hidden>
                    NOW
                  </Text>
                  <View style={styles.nowRule} />
                </View>
              ) : null}
              {visibleStages.map((st, i) =>
                i >= firstCol - 1 && i <= lastCol + 1 ? (
                  renderColumn(st, false)
                ) : (
                  <View key={st.id} style={[styles.col, { height: totalH }]} />
                ),
              )}
            </View>
          </ScrollView>
        </ScrollView>
      </View>

      {/* Off-screen export poster: a flat clone of the grid at explicit pixel
          dimensions. collapsable={false} keeps the View in the native tree so
          react-native-view-shot can grab it on Android (matches wrap.tsx). Only
          mounted while sharing — otherwise it's a full phantom grid (~950 Views)
          rendered on every screen paint. handleExport waits two frames after
          setSharing(true) so this is committed + laid out before captureRef. */}
      {sharing ? (
      <View
        ref={posterRef}
        collapsable={false}
        style={[styles.poster, { width: posterW, height: posterH }]}
        pointerEvents="none"
      >
        <View style={[styles.gutter, { height: posterH }]}>
          <View style={{ height: HEADER_H }} />
          <View style={{ height: totalH }}>
            {hours.map(({ m, px }) => (
              <Text key={m} style={[styles.hourLabel, { top: HEADER_H + px }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {fmtHour(m)}
              </Text>
            ))}
          </View>
        </View>
        <View>
          <View style={styles.headerRow}>
            {visibleStages.map((st) => (
              <View key={st.id} style={styles.headerCell}>
                <View style={[styles.stageDot, { backgroundColor: resolveStageColor(st.id) }]} />
                <Text style={styles.headerCellText} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {getStageName(st.id) || st.id}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.colsRow}>{visibleStages.map((st) => renderColumn(st, true))}</View>
        </View>
      </View>
      ) : null}
    </View>
  );
}

/**
 * Build an `rgba()` from a hex (or pass-through non-hex) color at the given
 * alpha. RN has no opacity-modifier syntax, so picked/stage cell tints (web's
 * color-mix) are approximated with a flat alpha over the dark grid bg. Falls
 * back to the source color when it isn't a parseable #rrggbb.
 */
function withAlpha(_t: Tokens, color: string, alpha: number): string {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return color;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const useStyles = makeStyles((t: Tokens) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  headerButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    height: HEADER_H,
    backgroundColor: t.colors.bg.primary,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  corner: {
    width: GUTTER_W,
    borderRightWidth: 1,
    borderRightColor: t.colors.border.light,
  },
  headerStrip: {
    flex: 1,
  },
  bodyRow: {
    flex: 1,
    flexDirection: 'row',
  },
  gutterStrip: {
    width: GUTTER_W,
    flexGrow: 0,
  },
  gutter: {
    width: GUTTER_W,
    borderRightWidth: 1,
    borderRightColor: t.colors.border.light,
    backgroundColor: t.colors.bg.primary,
  },
  hourLabel: {
    position: 'absolute',
    right: t.spacing[2],
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  headerRow: {
    flexDirection: 'row',
    height: HEADER_H,
    backgroundColor: t.colors.bg.primary,
  },
  headerCell: {
    width: COL_W,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    borderLeftWidth: 1,
    borderLeftColor: t.colors.border.default,
  },
  headerCellText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  stageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  colsRow: {
    flexDirection: 'row',
    position: 'relative',
  },
  col: {
    width: COL_W,
    borderLeftWidth: 1,
    borderLeftColor: t.colors.border.default,
    position: 'relative',
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: t.colors.border.light,
  },
  halfHourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: t.colors.border.default,
  },
  cell: {
    position: 'absolute',
    left: 4,
    right: 4,
    borderRadius: t.radii.sm,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 7,
    overflow: 'hidden',
    gap: 2,
  },
  pickHeart: {
    position: 'absolute',
    top: 3,
    right: 5,
    fontSize: 11,
    lineHeight: 12,
  },
  cellArtist: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
  cellTime: {
    ...typeStyle('micro'),
    color: t.colors.text.secondary,
  },
  overlapBadge: {
    position: 'absolute',
    bottom: 3,
    right: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[12],
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  overlapCount: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
  },
  nowLine: {
    position: 'absolute',
    left: 0,
    zIndex: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nowLabel: {
    ...typeStyle('micro'),
    color: t.colors.accent.coral,
    paddingHorizontal: 4,
  },
  nowRule: {
    flex: 1,
    height: 2,
    backgroundColor: t.colors.accent.coral,
    opacity: 0.8,
  },
  poster: {
    position: 'absolute',
    left: -99999,
    top: 0,
    flexDirection: 'row',
    backgroundColor: t.colors.bg.primary,
  },
}));
