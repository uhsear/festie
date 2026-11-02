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
import { useFestivalDataStore, useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { usePicks, useFestival, useDayClashes } from '@festie/shared/hooks';
import { COPY } from '@festie/shared/constants';
import {
  GRID_ZOOM_LEVELS,
  defaultZoomIndex,
  twoUpColumnWidth,
  pickClashTarget,
  nowPositionPercent,
  setMinuteRange,
  fmtHour,
  fmtShort,
  artistDisplayName,
  resolveFestivalTimeZone,
  type GridBounds,
  type HourMark,
} from '@festie/shared/utils';
import type { FestivalSet, Stage } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE, type Tokens } from '../hooks/useTokens';
import { safeStageColor } from '../lib/stageColor';
import { priorityIconName } from '../lib/prioritySymbol';
import { useNow } from '../hooks/useNow';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useQuickPick } from '../hooks/useQuickPick';
import EmptyState from '../components/EmptyState';
import ClashHatch from '../components/ClashHatch';
import ClashChip from '../components/ClashChip';
import TBASection from '../components/TBASection';

// Vertical scale comes from the shared GRID_ZOOM_LEVELS (px per minute, three
// steps). The screen opens at defaultZoomIndex(windowW), the middle level on a
// phone. The toolbar's Zoom out / Zoom in buttons step through the levels and
// keep the time in the middle of the body on screen.
// Sticky left time gutter. Matches the timeline gutter width (useNowIndicator /
// TimelineView use 44) so the two schedule surfaces line up visually.
const GUTTER_W = 44;
// Stage-column width is twoUpColumnWidth(windowW, GUTTER_W): two stages fill
// the width next to the gutter (clamped to 120-220 px), and the horizontal
// scroll snaps by one column.
// Header row height (stage name labels) above the scrollable body.
const HEADER_H = 40;
// WCAG 2.5.5 — a 15-min set at the smallest zoom is only 21px; bump cells to a 44px
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
 * day + active-stage filter, usePicks for the user's pick + crew overlap,
 * useDayClashes for clash marks and the clash chip, and useFestival for stage
 * color/name resolution. The pure grid math (zoom levels, two-up column width,
 * fmtHour, fmtShort, bounds) is imported from @festie/shared/utils.
 *
 * Holding a cell cycles its pick (useQuickPick). A day with only TBA sets shows
 * the stage-grouped TBA list instead of the empty state.
 *
 * Pick colors are resolved from the design tokens (t.colors.priority) rather
 * than the web grid's CSS `var(--color-accent-*)` strings, which RN can't parse.
 */
export default function GridScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const { width: windowW } = useWindowDimensions(); // re-render on rotation so the body re-measures.
  const colW = twoUpColumnWidth(windowW, GUTTER_W);
  const [zoom, setZoom] = useState(() => defaultZoomIndex(windowW));
  const pxPerMin = GRID_ZOOM_LEVELS[zoom]!;
  const reduceMotion = useReduceMotion();
  const { count: clashCount, marks, groups } = useDayClashes();
  const { holdToPick, setPick } = useQuickPick();

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const allSets = useFestivalDataStore((s) => s.sets);
  const stages = useFestivalDataStore((s) => s.stages);
  const user = useAuthStore((s) => s.user);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const { getMyPick, getOtherPicks } = usePicks();
  const { getStageColor, getStageName, getDays } = useFestival();

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

  // Timed sets for the selected day, respecting the active-stage filter — the
  // same predicate as the web grid's timedSets memo.
  const timedSets = useMemo(
    () =>
      allSets.filter(
        (s) =>
          s.dayIndex === selectedDay &&
          s.startTime &&
          s.endTime &&
          (activeStages.length === 0 ||
            activeStages.length === stages.length ||
            activeStages.includes(s.stageId)),
      ),
    [allSets, selectedDay, activeStages, stages],
  );

  // Same day and stage filter, but without a start or end time: the TBA list
  // shown when the day has nothing to place on the grid yet.
  const untimedSets = useMemo(() => {
    const sep = currentFestival?.b2bSeparator;
    return allSets
      .filter(
        (s) =>
          s.dayIndex === selectedDay &&
          (!s.startTime || !s.endTime) &&
          (activeStages.length === 0 ||
            activeStages.length === stages.length ||
            activeStages.includes(s.stageId)),
      )
      .sort((a, b) => artistDisplayName(a, sep).localeCompare(artistDisplayName(b, sep)));
  }, [allSets, selectedDay, activeStages, stages, currentFestival?.b2bSeparator]);

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
    for (let m = bounds.lo; m <= bounds.hi; m += 60) out.push({ m, px: (m - bounds.lo) * pxPerMin });
    return out;
  }, [bounds, pxPerMin]);

  // Live "now" minute (rolls past midnight to match the bounds). useNow ticks on
  // an interval + on foreground, so the indicator creeps forward without an
  // impure Date.now() in render.
  const nowMs = useNow(60_000);
  const dayDate = getDays()[selectedDay]?.date;
  const festivalTimeZone = resolveFestivalTimeZone(currentFestival);
  const nowPx = useMemo(() => {
    if (!bounds) return null;
    const pct = nowPositionPercent(nowMs, dayDate, { minMin: bounds.lo, maxMin: bounds.hi }, festivalTimeZone);
    return pct === null ? null : (pct / 100) * bounds.span * pxPerMin;
  }, [bounds, nowMs, dayDate, festivalTimeZone, pxPerMin]);

  const totalH = bounds ? bounds.span * pxPerMin : 0;

  // Auto-scroll the vertical body to NOW on mount (only when NOW is in bounds).
  const bodyScrollRef = useRef<ScrollViewInstance>(null);
  const headerScrollRef = useRef<ScrollViewInstance>(null);
  const gutterScrollRef = useRef<ScrollViewInstance>(null);
  const colsScrollRef = useRef<ScrollViewInstance>(null);
  const didAutoScroll = useRef(false);
  const [bodyH, setBodyH] = useState(0);
  // Body scroll offset (kept from onScroll) and the minute to re-centre on after a zoom step.
  const bodyYRef = useRef(0);
  const zoomCentreMinRef = useRef<number | null>(null);
  // Horizontal windowing: only stage columns within one column of the viewport
  // mount their gridlines and set cells; the rest are empty same-width spacers.
  const [firstCol, setFirstCol] = useState(0);
  const lastCol = firstCol + Math.ceil(windowW / colW);
  useEffect(() => {
    if (didAutoScroll.current || nowPx == null || bodyH === 0) return;
    didAutoScroll.current = true;
    const target = Math.max(0, nowPx - bodyH / 2);
    bodyScrollRef.current?.scrollTo({ y: target, animated: false });
  }, [nowPx, bodyH]);

  const changeZoom = useCallback(
    (next: number) => {
      if (next < 0 || next >= GRID_ZOOM_LEVELS.length || next === zoom) return;
      if (bounds) zoomCentreMinRef.current = bounds.lo + (bodyYRef.current + bodyH / 2) / pxPerMin;
      setZoom(next);
    },
    [zoom, bounds, bodyH, pxPerMin],
  );

  // After a zoom step, scroll so the minute that was in the middle stays there.
  useEffect(() => {
    const centreMin = zoomCentreMinRef.current;
    if (centreMin == null || !bounds) return;
    zoomCentreMinRef.current = null;
    const y = Math.max(0, (centreMin - bounds.lo) * pxPerMin - bodyH / 2);
    bodyScrollRef.current?.scrollTo({ y, animated: false });
  }, [pxPerMin, bounds, bodyH]);

  const showFirstClash = useCallback(() => {
    const target = pickClashTarget(groups, new Set(visibleStages.map((st) => st.id)));
    if (!target) return;
    const range = setMinuteRange(target.set);
    const colIndex = visibleStages.findIndex((st) => st.id === target.set.stageId);
    if (!target.visible || !bounds || !range || colIndex < 0) {
      router.push(`/set/${target.set.id}`);
      return;
    }
    const top = (range.start - bounds.lo) * pxPerMin;
    colsScrollRef.current?.scrollTo({ x: colIndex * colW, animated: !reduceMotion });
    bodyScrollRef.current?.scrollTo({ y: Math.max(0, top - 2 * 44), animated: !reduceMotion });
  }, [groups, visibleStages, bounds, pxPerMin, colW, reduceMotion, router]);

  // ── PNG export (replicates wrap.tsx's off-screen captureRef pipeline) ──
  const [sharing, setSharing] = useState(false);
  const posterRef = useRef<HostInstance>(null);
  const posterW = GUTTER_W + colW * Math.max(visibleStages.length, 1);
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

  const openSet = useCallback((s: FestivalSet) => router.push(`/set/${s.id}`), [router]);

  // ── Empty states (mirror the web grid) ──
  if (!currentFestival) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Schedule grid', headerShown: true }} />
        <EmptyState
          icon="calendar-outline"
          title="No festival selected"
          message="Choose a festival from the schedule tab to view the grid."
        />
      </View>
    );
  }
  if (!timedSets.length || !bounds) {
    if (untimedSets.length > 0) {
      return (
        <View style={styles.screen}>
          <Stack.Screen options={{ title: 'Schedule grid', headerShown: true }} />
          <ScrollView>
            <TBASection
              sets={untimedSets}
              stages={stages}
              canPick={!!user}
              currentFestival={currentFestival}
              getMyPick={getMyPick}
              getOtherPicks={getOtherPicks}
              getStageColor={resolveStageColor}
              onSavePick={setPick}
              onOpenDetail={openSet}
              defaultExpanded
              allTba
            />
          </ScrollView>
        </View>
      );
    }
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Schedule grid', headerShown: true }} />
        <EmptyState
          icon="time-outline"
          title="No timed sets to display"
          message="There are no sets with scheduled times for this day. Try switching days on the schedule tab."
        />
      </View>
    );
  }

  // One stage column body: hour gridlines + absolutely-positioned set cells.
  const renderColumn = (st: Stage, forExport: boolean) => {
    const stageColor = resolveStageColor(st.id);
    const stageSets = setsByStage.get(st.id) || [];
    return (
      <View key={st.id} style={[styles.col, { width: colW, height: totalH }]}>
        {/* Hour gridlines (and a fainter half-hour line) */}
        {hours.map(({ m, px }) => (
          <View key={m} style={[styles.hourLine, { top: px }]} />
        ))}
        {hours.slice(0, -1).map(({ m, px }) => (
          <View key={`half-${m}`} style={[styles.halfHourLine, { top: px + 30 * pxPerMin }]} />
        ))}

        {stageSets.map((set) => {
          const { start: a, end: b } = setMinuteRange(set)!;
          const top = (a - bounds.lo) * pxPerMin;
          const height = Math.max((b - a) * pxPerMin, MIN_CELL_H);
          const pick = getMyPick(set.id);
          const pickColor = pick ? t.colors.priority[pick === 'want-to-see' ? 'want' : pick] : null;
          const cellColor = pickColor ?? stageColor;
          const dn = artistDisplayName(set, currentFestival.b2bSeparator);
          const overlap = getOverlapCount(set.id);
          const mark = marks.get(set.id);

          const cellStyle = {
            top,
            height,
            backgroundColor: pickColor ? withAlpha(t, pickColor, 0.28) : withAlpha(t, stageColor, 0.14),
            borderColor: mark ? t.colors.clash.mark : cellColor,
            borderWidth: mark ? 2 : 1,
          };

          // The off-screen export poster is captured by react-native-view-shot;
          // it must be a flat View (a Pressable inside a captured tree is fine,
          // but we avoid the press handler / accessibility on the clone).
          const inner = (
            <>
              {mark ? <ClashHatch segments={mark.segments} height={height} color={t.colors.clash.mark} /> : null}
              {mark || pick ? (
                <View style={styles.iconRow}>
                  {mark ? <Ionicons name="warning-outline" size={11} color={t.colors.clash.mark} aria-hidden /> : null}
                  {pick ? <Ionicons name={priorityIconName(pick)} size={11} color={cellColor} aria-hidden /> : null}
                </View>
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
              {...holdToPick(set.id, pick)}
              accessibilityRole="button"
              accessibilityLabel={`${dn} at ${getStageName(st.id) || st.id}, ${fmtShort(set.startTime!)} to ${fmtShort(set.endTime!)}${pick ? ', ' + pick : ''}${overlapLabel}${mark ? ', ' + mark.text : ''}`}
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
          title: 'Schedule grid',
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

      <View style={styles.toolbar}>
        <ClashChip count={clashCount} onPress={showFirstClash} />
        <View style={styles.zoomButtons}>
          <TouchableOpacity
            onPress={() => changeZoom(zoom - 1)}
            disabled={zoom === 0}
            accessibilityRole="button"
            accessibilityLabel={COPY.grid.zoomOut}
            accessibilityHint={COPY.grid.zoomOutHint}
            accessibilityState={{ disabled: zoom === 0 }}
            style={[styles.zoomButton, zoom === 0 && styles.zoomButtonDisabled]}
          >
            <Ionicons name="remove-outline" size={t.iconSize.md} color={t.colors.text.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => changeZoom(zoom + 1)}
            disabled={zoom === GRID_ZOOM_LEVELS.length - 1}
            accessibilityRole="button"
            accessibilityLabel={COPY.grid.zoomIn}
            accessibilityHint={COPY.grid.zoomInHint}
            accessibilityState={{ disabled: zoom === GRID_ZOOM_LEVELS.length - 1 }}
            style={[styles.zoomButton, zoom === GRID_ZOOM_LEVELS.length - 1 && styles.zoomButtonDisabled]}
          >
            <Ionicons name="add-outline" size={t.iconSize.md} color={t.colors.text.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Sticky chrome: the stage header row and the time gutter are separate,
          non-interactive ScrollViews whose offsets follow the body below, so
          stage names and hour labels stay on screen on both axes. */}
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
              <View key={st.id} style={[styles.headerCell, { width: colW }]}>
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
          snapToOffsets={hours.map((h) => h.px)}
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={(e) => {
            const y = e.nativeEvent.contentOffset.y;
            bodyYRef.current = y;
            gutterScrollRef.current?.scrollTo({ y, animated: false });
          }}
          onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}
        >
          <ScrollView
            ref={colsScrollRef}
            horizontal
            showsHorizontalScrollIndicator
            snapToInterval={colW}
            decelerationRate="fast"
            scrollEventThrottle={16}
            onScroll={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              headerScrollRef.current?.scrollTo({ x, animated: false });
              const col = Math.max(0, Math.floor(x / colW));
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
                <View style={[styles.nowLine, { top: nowPx, width: colW * visibleStages.length }]} pointerEvents="none">
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
                  <View key={st.id} style={[styles.col, { width: colW, height: totalH }]} />
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
              <View key={st.id} style={[styles.headerCell, { width: colW }]}>
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
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    gap: t.spacing[2],
  },
  zoomButtons: {
    flexDirection: 'row',
    marginLeft: 'auto',
  },
  zoomButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomButtonDisabled: {
    opacity: 0.4,
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
  iconRow: {
    position: 'absolute',
    top: 3,
    right: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
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
