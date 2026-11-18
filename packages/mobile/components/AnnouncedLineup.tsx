import { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useFestivalDataStore, useFestivalStore } from '@festie/shared/stores';
import type { LineupEntry } from '@festie/shared/types';
import {
  groupLineupAlphabetically,
  groupLineupByTier,
  lineupCoveringSets,
  lineupEntryBadge,
  lineupEntryName,
  lineupSetWhen,
  searchLineupEntries,
  selectLineupEntries,
} from '@festie/shared/utils';
import type { AnnouncedLineupModel } from '../hooks/useAnnouncedLineup';
import { useNow } from '../hooks/useNow';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { LINEUP_VIEW_KEY, parseLineupView, type LineupView } from '../lib/lineupView';
import SegmentedControl from './SegmentedControl';

const VIEW_OPTIONS: { value: LineupView; label: string }[] = [
  { value: 'poster', label: 'Poster' },
  { value: 'az', label: 'A-Z' },
];

type NameTier = 'tier1' | 'tier2' | 'rest';
// Tier 1 is the top line of the poster, so it gets the largest type.
const nameTier = (tier: number | null): NameTier => (tier === 1 ? 'tier1' : tier === 2 ? 'tier2' : 'rest');

/**
 * The announced lineup: acts the organizer has named before, or without, set times. Mirrors the web
 * component of the same name; every rule (badges, day filter, grouping, search) comes from
 * `@festie/shared/utils`. A search replaces it with the acts that match.
 */
export default function AnnouncedLineup({ model, hPad = 0 }: { model: AnnouncedLineupModel; hPad?: number }) {
  const styles = useStyles();
  const router = useRouter();
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const sets = useFestivalDataStore((s) => s.sets);
  const stages = useFestivalDataStore((s) => s.stages);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const nowMs = useNow(60_000);
  const [view, setView] = useState<LineupView>('poster');
  const [full, setFull] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(LINEUP_VIEW_KEY)
      .then((raw) => setView(parseLineupView(raw)))
      .catch((err: unknown) => console.warn('lineup: could not read the saved view', err));
  }, []);

  const query = (searchQuery ?? '').trim();
  const matches = useMemo(
    () => (query ? searchLineupEntries(model.lineup, model.cover, query) : []),
    [model.lineup, model.cover, query],
  );
  const selection = useMemo(
    () =>
      full
        ? selectLineupEntries(model.lineup, model.cover, sets, { dayIndex: selectedDay, fullLineup: true })
        : model.selection,
    [full, model.lineup, model.cover, model.selection, sets, selectedDay],
  );

  if (!model.visible) return null;

  const separator = festival?.b2bSeparator;
  const changeView = (next: LineupView) => {
    setView(next);
    AsyncStorage.setItem(LINEUP_VIEW_KEY, next).catch((err: unknown) =>
      console.warn('lineup: could not save the view', err),
    );
  };

  const renderRow = (entry: LineupEntry, tier: NameTier) => {
    const cover = model.cover[entry.id];
    if (!cover) return null;
    const first = cover.state === 'scheduled' ? lineupCoveringSets(cover, sets)[0] : undefined;
    const badges = lineupEntryBadge(entry, cover, model.days, festival?.publishedAt, nowMs);
    const name = (
      <Text
        style={[styles[tier], cover.state === 'cancelled' && styles.cancelled]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {lineupEntryName(entry, separator)}
      </Text>
    );
    return (
      <View key={entry.id} style={styles.row}>
        {first ? (
          <TouchableOpacity
            style={styles.rowLink}
            onPress={() => router.push(`/set/${first.id}`)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${lineupEntryName(entry, separator)}, ${lineupSetWhen(first, model.days, stages)}`}
          >
            {name}
            <Text style={styles.when} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {lineupSetWhen(first, model.days, stages)}
            </Text>
          </TouchableOpacity>
        ) : (
          name
        )}
        {badges.map((badge) => (
          <View key={badge.kind} style={[styles.pill, badge.kind === 'new' && styles.pillNew]}>
            <Text style={[styles.pillText, badge.kind === 'new' && styles.pillTextNew]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {badge.text}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  if (query) {
    if (matches.length === 0) return null;
    return (
      <View style={[styles.search, { marginHorizontal: hPad }]} accessibilityLabel="Announced acts">
        <Text style={styles.groupHeading} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Announced acts
        </Text>
        {matches.map((entry) => renderRow(entry, 'rest'))}
      </View>
    );
  }

  const { summary } = model;
  const nothingToList = selection.active.length === 0 && selection.cancelled.length === 0;

  return (
    <View style={[styles.card, { marginHorizontal: hPad }]}>
      <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        Announced lineup
      </Text>
      <Text style={styles.summary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {summary.header}
      </Text>
      {model.noSets ? (
        <Text style={styles.summary} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Set times aren’t out yet.
        </Text>
      ) : null}

      <View style={styles.controls}>
        <View style={styles.viewSwitch}>
          <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={changeView} accessibilityLabel="Lineup view" />
        </View>
        {summary.scheduled > 0 ? (
          <TouchableOpacity
            style={[styles.fullToggle, full && styles.fullToggleOn]}
            onPress={() => setFull((on) => !on)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: full }}
            accessibilityLabel="Full lineup"
          >
            <Text style={[styles.fullToggleText, full && styles.fullToggleTextOn]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Full lineup
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {nothingToList ? (
        <Text style={styles.empty} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {summary.scheduled > 0
            ? 'Every announced act for this day is on the timetable. Open the full lineup to see them.'
            : 'No announced acts for this day yet.'}
        </Text>
      ) : view === 'poster' ? (
        <View style={styles.groups}>
          {groupLineupByTier(selection.active).map((group) => (
            <View key={group.tier ?? 'none'}>{group.entries.map((entry) => renderRow(entry, nameTier(group.tier)))}</View>
          ))}
        </View>
      ) : (
        <View style={styles.groups}>
          {groupLineupAlphabetically(selection.active, separator).map((group) => (
            <View key={group.letter}>
              <Text style={styles.groupHeading} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {group.letter}
              </Text>
              {group.entries.map((entry) => renderRow(entry, 'rest'))}
            </View>
          ))}
        </View>
      )}

      {selection.cancelled.length > 0 ? (
        <View style={styles.groups}>
          <Text style={styles.groupHeading} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Cancelled
          </Text>
          {selection.cancelled.map((entry) => renderRow(entry, 'rest'))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    marginTop: t.spacing[3],
    padding: t.spacing[4],
    gap: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  search: { marginTop: t.spacing[3], gap: t.spacing[1] },
  title: { ...typeStyle('title'), color: t.colors.text.primary },
  summary: { ...typeStyle('label'), color: t.colors.text.secondary },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    marginTop: t.spacing[2],
  },
  viewSwitch: { flexGrow: 1, flexBasis: 160 },
  fullToggle: {
    minHeight: 44,
    paddingHorizontal: t.spacing[4],
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  fullToggleOn: { backgroundColor: t.colors.accent.aqua, borderColor: t.colors.accent.aqua },
  fullToggleText: { ...typeStyle('label', 600), color: t.colors.text.secondary },
  fullToggleTextOn: { color: t.colors.text.onLightAccent },
  empty: { ...typeStyle('label'), color: t.colors.text.secondary, marginTop: t.spacing[3] },
  groups: { marginTop: t.spacing[3], gap: t.spacing[1] },
  groupHeading: { ...typeStyle('label', 600), color: t.colors.text.secondary },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: t.spacing[2],
    rowGap: t.spacing[1],
    paddingVertical: t.spacing[1],
  },
  rowLink: { minHeight: 44, justifyContent: 'center' },
  tier1: { ...typeStyle('heading'), color: t.colors.text.primary },
  tier2: { ...typeStyle('title'), color: t.colors.text.primary },
  rest: { ...typeStyle('body', 500), color: t.colors.text.primary },
  cancelled: { textDecorationLine: 'line-through', color: t.colors.text.muted },
  when: { ...typeStyle('caption'), color: t.colors.text.secondary },
  pill: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 2,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  pillNew: { borderColor: t.colors.accent.aqua },
  pillText: { ...typeStyle('caption'), color: t.colors.text.secondary },
  pillTextNew: { color: t.colors.accent.aqua },
}));
