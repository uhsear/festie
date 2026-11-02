import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { useCrew, useFestival } from '@festie/shared/hooks';
import { artistDisplayName, formatTime, byStartTime } from '@festie/shared/utils';
import { COPY, PRIORITY_LABEL, signInTo } from '@festie/shared/constants';
import type { FestivalSet, Priority, Profile } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { safeStageColor } from '../lib/stageColor';
import { priorityIconName } from '../lib/prioritySymbol';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';

const ROW_HEADER_W = 168;
const CELL_W = 76;
// Fixed heights keep the pinned set column and the scrolling pick cells aligned
// row for row (they render in two separate views). Sized for MAX_FONT_SCALE.
const HEADER_H = 56;
const ROW_H = 64;

type Column = { id: string; name: string; isMe: boolean; avatarName?: string };

export default function CrewCompareScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewLoading = useCrewStore((s) => s.crewLoading);
  const error = useCrewStore((s) => s.error);
  const loadOverlap = useCrewStore((s) => s.loadOverlap);

  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const sets = useFestivalStore((s) => s.sets) as FestivalSet[];
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);

  const { getCrewScopedProfiles } = useCrew();
  const { getDays, getStageColor } = useFestival();

  const [refreshing, setRefreshing] = useState(false);

  // Refresh crew overlap (drives the "going" count + keeps the crew picks/profiles
  // fresh). The grid is derived from those picks. Reused by mount + pull-to-refresh
  // + the error retry (F41).
  // The narrow deps (activeCrew?.id / ?.festivalId, not the whole activeCrew
  // object) are deliberate and load-bearing: `refresh` feeds useEffect([refresh])
  // below, so widening to `activeCrew` (what the compiler infers) would re-fire
  // the mount fetch on every store-driven object-identity change. React Compiler
  // is not enabled here, so we keep the manual memo and suppress its readiness warning.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional narrower deps; widening would cause redundant overlap refetches
  const refresh = useCallback(async () => {
    const festivalId = activeCrew?.festivalId ?? currentFestival?.id;
    if (!activeCrew?.id || !festivalId) return;
    setRefreshing(true);
    try {
      await loadOverlap(activeCrew.id, festivalId);
    } catch {
      // Error is surfaced via the crew store's `error`.
    } finally {
      setRefreshing(false);
    }
  }, [activeCrew?.id, activeCrew?.festivalId, currentFestival?.id, loadOverlap]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- genuine data-fetch side effect: refresh() flips the refreshing flag before its async overlap GET; not derivable from render inputs
    void refresh();
  }, [refresh]);

  const days = useMemo(() => getDays(), [getDays]);

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const p of getCrewScopedProfiles()) map.set(p.id, p);
    if (currentProfile) map.set(currentProfile.id, currentProfile);
    return map;
  }, [getCrewScopedProfiles, currentProfile]);

  // Columns: you first, then the rest of the crew.
  const columns = useMemo<Column[]>(() => {
    const profiles = getCrewScopedProfiles();
    const others = profiles.filter((p) => p.id !== currentProfile?.id);
    const cols: Column[] = [];
    if (currentProfile) {
      cols.push({ id: currentProfile.id, name: 'You', isMe: true, avatarName: currentProfile.name });
    }
    for (const p of others) {
      cols.push({ id: p.id, name: p.name || 'Member', isMe: false, avatarName: p.name });
    }
    return cols;
  }, [getCrewScopedProfiles, currentProfile]);

  // Rows: this day's sets that at least one crew member picked, time-sorted.
  const rows = useMemo<FestivalSet[]>(() => {
    return sets
      .filter((s) => s.dayIndex === selectedDay)
      .filter((s) => columns.some((c) => profileById.get(c.id)?.picks?.[s.id]))
      .sort(byStartTime);
  }, [sets, selectedDay, columns, profileById]);

  const pickFor = (col: Column, setId: string): Priority | undefined => profileById.get(col.id)?.picks?.[setId];

  if (!user) {
    return (
      <Wrapper>
        <EmptyState icon="lock-closed" title={COPY.auth.signInRequired} message={signInTo('compare schedules')} />
      </Wrapper>
    );
  }
  if (!activeCrew) {
    return (
      <Wrapper>
        <EmptyState icon="people-outline" title="No crew" message="Join or create a crew to compare schedules." />
      </Wrapper>
    );
  }
  if (columns.length <= 1) {
    return (
      <Wrapper>
        {crewLoading ? (
          <LoadingState label="Loading crew picks…" />
        ) : (
          <EmptyState
            icon="git-compare-outline"
            title="No crew picks yet"
            message="Once your crewmates save picks for this festival, their schedules show up here side by side."
          />
        )}
      </Wrapper>
    );
  }

  if (error) {
    return (
      <Wrapper>
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load crew picks"
          message={error}
          action={{ label: 'Try again', onPress: () => void refresh() }}
        />
      </Wrapper>
    );
  }

  return (
    <Wrapper>

      {/* Day selector */}
      {days.length > 1 ? (
        <View style={styles.daysWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysContent}>
            {days.map((day) => {
              const active = day.index === selectedDay;
              return (
                <TouchableOpacity
                  key={day.index}
                  style={styles.dayChip}
                  onPress={() => setSelectedDay(day.index)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Day: ${day.label ?? day.date}`}
                >
                  <View style={[styles.dayChipBg, active && styles.dayChipBgActive]} pointerEvents="none" />
                  <Text
                    style={[styles.dayText, active && styles.dayTextActive]}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    textBreakStrategy="simple"
                  >
                    {day.label ?? day.date}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {rows.length === 0 ? (
        // Refreshable empty state (F41): a crewmate's picks may still be syncing,
        // so let the user pull to re-fetch without leaving the screen.
        <ScrollView
          contentContainerStyle={styles.flex1}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={t.colors.accent.aqua}
              colors={[t.colors.accent.aqua]}
            />
          }
        >
          <EmptyState
            icon="calendar-outline"
            title="No picks on this day yet"
            message="Switch days or have your crew add picks to see the overlap. Pull to refresh."
          />
        </ScrollView>
      ) : (
        // The set column is pinned: one vertical ScrollView holds a fixed left
        // column (set names) beside a horizontal ScrollView (member picks), so a
        // sideways scroll never hides which set a row is.
        <ScrollView
          style={styles.flex1}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={t.colors.accent.aqua}
              colors={[t.colors.accent.aqua]}
            />
          }
          contentContainerStyle={{
            paddingBottom: Math.max(t.spacing[4], insets.bottom + t.spacing[2]),
          }}
        >
          <View style={styles.gridWrap}>
            <View style={styles.pinnedColumn}>
              <View style={[styles.rowHeaderCell, styles.cornerCell]}>
                <Text style={styles.cornerText}>Set</Text>
              </View>
              {rows.map((set) => {
                const name = artistDisplayName(set, currentFestival?.b2bSeparator);
                // Crew Overlap: how many members picked this set.
                const pickedBy = columns.filter((c) => pickFor(c, set.id)).length;
                return (
                  <TouchableOpacity
                    key={set.id}
                    style={[styles.rowHeaderCell, styles.gridRowHeight]}
                    onPress={() => router.push(`/set/${set.id}`)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${name}. ${pickedBy} of ${columns.length} picked`}
                  >
                    <View style={styles.rowHeaderInner}>
                      <View
                        style={[
                          styles.stageDot,
                          { backgroundColor: safeStageColor(getStageColor(set.stageId), t.colors.text.muted) },
                        ]}
                      />
                      <View style={styles.rowHeaderText}>
                        <Text style={styles.setArtist} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                          {name}
                        </Text>
                        <Text style={styles.setTime} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                          {set.startTime ? `${formatTime(set.startTime)} · ` : ''}
                          {pickedBy} of {columns.length} picked
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.gridScroll}>
              <View>
                {/* Column headers */}
                <View style={styles.headerRow}>
                  {columns.map((col) => (
                    <View key={col.id} style={styles.colHeader}>
                      <Avatar name={col.avatarName} size="xs" />
                      <Text style={styles.colHeaderText} numberOfLines={1}>
                        {col.name}
                      </Text>
                    </View>
                  ))}
                </View>
                {rows.map((set) => (
                  <View key={set.id} style={[styles.gridRow, styles.gridRowHeight]}>
                    {columns.map((col) => {
                      const p = pickFor(col, set.id);
                      return (
                        <View
                          key={col.id}
                          style={styles.cell}
                          // Preserve the table relation (member × set → pick) for
                          // screen readers; without a label the cell reads as empty.
                          accessibilityLabel={`${col.name}: ${p ? PRIORITY_LABEL[p] : 'no pick'} for ${artistDisplayName(set, currentFestival?.b2bSeparator)}`}
                        >
                          {p ? (
                            <View
                              style={[
                                styles.pill,
                                {
                                  backgroundColor:
                                    p === 'must'
                                      ? t.colors.priority.must
                                      : p === 'want-to-see'
                                        ? t.colors.priority.want
                                        : t.colors.priority.maybe,
                                },
                              ]}
                            >
                              <Ionicons name={priorityIconName(p)} size={t.iconSize.xs} color={t.colors.text.onLightAccent} />
                              <Text style={styles.pillText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                                {PRIORITY_LABEL[p]}
                              </Text>
                            </View>
                          ) : (
                            <Text style={styles.dash}>—</Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </ScrollView>
      )}
    </Wrapper>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'Compare schedules',
          presentation: 'modal',
          headerShown: true,
          headerStyle: { backgroundColor: t.colors.bg.secondary },
          headerTintColor: t.colors.text.primary,
        }}
      />
      {children}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  flex1: {
    flex: 1,
  },
  daysWrap: {
    paddingVertical: t.spacing[3],
  },
  daysContent: {
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
  },
  dayChip: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    // WCAG 2.5.5 / 2.5.8 minimum 44x44px (F36) — matches (tabs)/index.tsx dayChip.
    minHeight: 44,
    justifyContent: 'center',
  },
  dayChipBg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  dayChipBgActive: {
    backgroundColor: t.colors.accent.aqua,
    borderColor: t.colors.accent.aqua,
  },
  dayText: {
    ...typeStyle('label'),
    fontFamily: Platform.OS === 'android' ? undefined : typeStyle('label').fontFamily,
    color: t.colors.text.secondary,
  },
  dayTextActive: {
    color: t.colors.text.onLightAccent,
  },
  gridWrap: {
    flexDirection: 'row',
  },
  // Pinned set-name column: opaque so pick cells never show through it.
  pinnedColumn: {
    paddingLeft: t.spacing[4],
    backgroundColor: t.colors.bg.primary,
  },
  gridScroll: {
    paddingRight: t.spacing[4],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: HEADER_H,
  },
  cornerCell: {
    justifyContent: 'flex-end',
    height: HEADER_H,
  },
  gridRowHeight: {
    height: ROW_H,
    justifyContent: 'center',
  },
  cornerText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  colHeader: {
    width: CELL_W,
    alignItems: 'center',
    gap: t.spacing[1],
  },
  colHeaderText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    maxWidth: CELL_W - 8,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowHeaderCell: {
    width: ROW_HEADER_W,
    paddingRight: t.spacing[3],
  },
  rowHeaderInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  stageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowHeaderText: {
    flex: 1,
    gap: 2,
  },
  setArtist: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  setTime: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    fontVariant: ['tabular-nums'],
  },
  cell: {
    width: CELL_W,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    minWidth: 52,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: t.spacing[1],
  },
  pillText: {
    ...typeStyle('caption', 700),
    color: t.colors.text.onLightAccent,
  },
  dash: {
    ...typeStyle('body'),
    color: t.colors.text.muted,
  },
}));
