import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useFestivalStore, useUIStore } from '@festie/shared/stores';
import { useActiveCrew, useCrewCompare, useCrewFestival, useFestival, usePicks } from '@festie/shared/hooks';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { artistDisplayName, formatTime } from '@festie/shared/utils';
import { PRIORITY_LABEL } from '@festie/shared/constants';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { safeStageColor } from '../lib/stageColor';
import { priorityIconName } from '../lib/prioritySymbol';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import CrewSuggestionStrip from '../components/CrewSuggestionStrip';
import CrewCompareSummary from '../components/CrewCompareSummary';

const ROW_HEADER_W = 168;
const CELL_W = 76;
// Fixed heights keep the pinned set column and the scrolling pick cells aligned
// row for row (they render in two separate views). Sized for MAX_FONT_SCALE.
const HEADER_H = 56;
const ROW_H = 64;

export default function CrewCompareScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const { status, crew: activeCrew, retry: retryCrew } = useActiveCrew();
  const festivalSwitch = useCrewFestival(activeCrew);

  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);

  const [sort, setSort] = useState<'time' | 'mix'>('time');
  const { columns, rows, freeTogether, split, together, timeZone } = useCrewCompare(sort);
  const { savePick } = usePicks();
  const { getDays, getStageColor } = useFestival();

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The grid reads the festival store's `allProfiles`, so refresh reloads those
  // (loadOverlap only fed the crew store). It waits until the festival store
  // follows the crew's festival.
  const festivalId = currentFestival?.id;
  const ready = festivalSwitch.state === 'match' && status === 'ready';
  const refresh = useCallback(async () => {
    if (!festivalId) return;
    setRefreshing(true);
    setError(null);
    try {
      await useFestivalStore.getState().loadProfiles(festivalId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load crew picks.");
    } finally {
      setRefreshing(false);
    }
  }, [festivalId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- genuine data-fetch side effect: refresh() flips the refreshing flag before its async profiles GET; not derivable from render inputs
    if (ready) void refresh();
  }, [refresh, ready]);

  const days = useMemo(() => getDays(), [getDays]);

  const handleAdd = useCallback(
    (setId: string, priority: Parameters<typeof savePick>[2]) => {
      if (!festivalId) return;
      savePick(festivalId, setId, priority).catch((err) => {
        useUIStore
          .getState()
          .showToast(mapErrorToUserMessage(err, "Couldn't save your pick. Try again."), { kind: 'error' });
      });
    },
    [festivalId, savePick],
  );

  if (!user) {
    return (
      <Wrapper>
        <EmptyState icon="lock-closed" title="Sign in required" message="Log in to compare schedules." />
      </Wrapper>
    );
  }
  if (status === 'loading') {
    return (
      <Wrapper>
        <LoadingState label="Loading your crew…" />
      </Wrapper>
    );
  }
  if (status === 'error') {
    return (
      <Wrapper>
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load your crew"
          message="Check your connection, then try again."
          action={{ label: 'Try again', onPress: retryCrew }}
        />
      </Wrapper>
    );
  }
  if (status === 'none' || !activeCrew) {
    return (
      <Wrapper>
        <EmptyState
          icon="people-outline"
          title="No crew yet"
          message="Make a crew or join one with a code to plan together."
          action={{ label: 'Create or join a crew', onPress: () => router.navigate('/(tabs)/crew') }}
        />
      </Wrapper>
    );
  }
  if (festivalSwitch.state === 'switching') {
    return (
      <Wrapper>
        <LoadingState label={`Opening ${festivalSwitch.festivalName}…`} />
      </Wrapper>
    );
  }
  if (festivalSwitch.state === 'failed') {
    return (
      <Wrapper>
        <EmptyState
          icon="cloud-offline-outline"
          title={`Couldn't open ${festivalSwitch.festivalName}`}
          message={`${activeCrew.name} is planning ${festivalSwitch.festivalName}. Connect to the internet, then try again.`}
          action={{ label: 'Try again', onPress: festivalSwitch.retry }}
        />
      </Wrapper>
    );
  }
  if (columns.length <= 1) {
    return (
      <Wrapper>
        <EmptyState
          icon="git-compare-outline"
          title="No crew picks yet"
          message="Once your crewmates save picks for this festival, their schedules show up here side by side."
        />
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
      <View style={styles.topWrap}>
        <CrewSuggestionStrip title="Your crew is seeing, you're missing" />
        <CrewCompareSummary
          columns={columns}
          freeTogether={freeTogether}
          split={split}
          together={together}
          timeZone={timeZone}
        />
      </View>

      {/* Day selector + sort */}
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
      <View style={styles.sortRow}>
        {(
          [
            ['time', 'Time'],
            ['mix', 'Most picked'],
          ] as const
        ).map(([key, label]) => {
          const active = sort === key;
          return (
            <TouchableOpacity
              key={key}
              style={styles.dayChip}
              onPress={() => setSort(key)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Sort by ${label}`}
            >
              <View style={[styles.dayChipBg, active && styles.dayChipBgActive]} pointerEvents="none" />
              <Text
                style={[styles.dayText, active && styles.dayTextActive]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                textBreakStrategy="simple"
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

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
              {rows.map(({ set, pickers: pickedBy }) => {
                const name = artistDisplayName(set, currentFestival?.b2bSeparator);
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
                    <View key={col.profileId} style={styles.colHeader}>
                      <Avatar name={col.name} size="xs" />
                      <Text style={styles.colHeaderText} numberOfLines={1}>
                        {col.isMe ? 'You' : col.name}
                      </Text>
                      <View style={[styles.colBar, { backgroundColor: col.color }]} />
                    </View>
                  ))}
                </View>
                {rows.map(({ set, picks, topPriority }) => (
                  <View key={set.id} style={[styles.gridRow, styles.gridRowHeight]}>
                    {columns.map((col) => {
                      const p = picks[col.profileId];
                      if (!p && col.isMe) {
                        const artist = artistDisplayName(set, currentFestival?.b2bSeparator);
                        return (
                          <TouchableOpacity
                            key={col.profileId}
                            style={[styles.cell, styles.addCell]}
                            onPress={() => handleAdd(set.id, topPriority)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel={`Add ${artist} to my picks`}
                          >
                            <Ionicons name="add-circle-outline" size={t.iconSize.sm} color={t.colors.accent.aqua} />
                            <Text style={styles.addText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                              Add
                            </Text>
                          </TouchableOpacity>
                        );
                      }
                      return (
                        <View
                          key={col.profileId}
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
                              <Ionicons
                                name={priorityIconName(p)}
                                size={t.iconSize.xs}
                                color={t.colors.text.onLightAccent}
                              />
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
  topWrap: {
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[3],
  },
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
    paddingBottom: t.spacing[2],
  },
  colBar: {
    height: 3,
    width: CELL_W - 24,
    borderRadius: 2,
  },
  addCell: {
    height: ROW_H,
    gap: 2,
  },
  addText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
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
